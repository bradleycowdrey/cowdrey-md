"""Fill in the Cowdrey.MD App Store listing through the App Store Connect API.

Reads docs/app-store/listing.json and the screenshots beside it. Sets the category, content rights,
age rating, price (free), availability, the version's text and screenshots, App Review details, and
attaches the newest processed build for the version in tauri.conf.json. It submits for review only when listing.json's
submitForReview names the exact version, and only after every other step succeeded.

With --build-only (after each iPhone build) it only sets the version number and attaches the build.
If listing.json names a version in withdrawFromReview, that exact version is first taken out of App Review.

Each step runs on its own and reports what happened, so one refusal doesn't stop the rest.
Environment: APPLE_API_ISSUER, APPLE_API_KEY (key ID), P8 (private key text).
"""
import hashlib, json, os, sys, time, urllib.error, urllib.request

import jwt

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOTS = os.path.join(ROOT, 'docs', 'app-store')
L = json.load(open(os.path.join(SHOTS, 'listing.json')))
VERSION = json.load(open(os.path.join(ROOT, 'desktop', 'src-tauri', 'tauri.conf.json')))['version']
API = 'https://api.appstoreconnect.apple.com'
results = []


def token():
    now = int(time.time())
    return jwt.encode({'iss': os.environ['APPLE_API_ISSUER'].strip(), 'iat': now, 'exp': now + 900, 'aud': 'appstoreconnect-v1'},
                      os.environ['P8'].replace('\r', '').strip(), algorithm='ES256',
                      headers={'kid': os.environ['APPLE_API_KEY'].strip(), 'typ': 'JWT'})


class ApiError(Exception):
    pass


def call(method, path, body=None):
    url = path if path.startswith('http') else API + path
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        text = e.read().decode(errors='replace')
        try:
            errs = json.loads(text)['errors']
            parts = []
            for x in errs:
                parts.append(f"{x.get('title')}: {x.get('detail')}")
                # Apple puts the real reasons a resource can't be submitted under meta.associatedErrors.
                for path, subs in ((x.get('meta') or {}).get('associatedErrors') or {}).items():
                    for y in subs:
                        parts.append(f"  · {y.get('code')}: {y.get('detail') or y.get('title')}")
            text = '\n'.join(parts)
        except Exception:
            pass
        raise ApiError(f'{method} {path.split("?")[0]} → HTTP {e.code}: {text}')


def step(name):
    def wrap(fn):
        def run(*a):
            try:
                out = fn(*a)
                results.append(('OK', name, out or ''))
                return out
            except Exception as e:
                results.append(('NEEDS YOU', name, str(e)))
        return run
    return wrap


def rel(type_, id_):
    return {'data': {'type': type_, 'id': id_}}


app = call('GET', f"/v1/apps?filter[bundleId]={L['bundleId']}")['data'][0]
APP = app['id']
print(f"App: {app['attributes']['name']} ({APP}), version {VERSION}")


@step('Content rights: no third-party content')
def content_rights():
    call('PATCH', f'/v1/apps/{APP}', {'data': {'type': 'apps', 'id': APP, 'attributes': {'contentRightsDeclaration': 'DOES_NOT_USE_THIRD_PARTY_CONTENT'}}})


def editable_app_info():
    infos = call('GET', f'/v1/apps/{APP}/appInfos')['data']
    live = ('READY_FOR_DISTRIBUTION', 'READY_FOR_SALE', 'REPLACED_WITH_NEW_INFO')
    for i in infos:
        if i['attributes'].get('state') not in live and i['attributes'].get('appStoreState') not in live:
            return i
    return infos[0]


@step('Category: Productivity, then Utilities')
def category(info):
    call('PATCH', f"/v1/appInfos/{info['id']}", {'data': {'type': 'appInfos', 'id': info['id'], 'relationships': {
        'primaryCategory': rel('appCategories', L['primaryCategory']), 'secondaryCategory': rel('appCategories', L['secondaryCategory'])}}})


@step('Subtitle and privacy policy URL')
def info_text(info):
    locs = call('GET', f"/v1/appInfos/{info['id']}/appInfoLocalizations")['data']
    loc = next((x for x in locs if x['attributes']['locale'] == L['locale']), locs[0])
    call('PATCH', f"/v1/appInfoLocalizations/{loc['id']}", {'data': {'type': 'appInfoLocalizations', 'id': loc['id'], 'attributes': {
        'subtitle': L['subtitle'], 'privacyPolicyUrl': L['privacyPolicyUrl']}}})


@step('Age rating: 4+ (none of the listed content)')
def age_rating(info):
    decl = call('GET', f"/v1/appInfos/{info['id']}/ageRatingDeclaration")['data']
    want = {}
    for k, v in decl['attributes'].items():
        if isinstance(v, bool) or k in ('gambling', 'unrestrictedWebAccess', 'lootBox', 'messagingAndChat', 'parentalControls',
                                        'ageAssurance', 'userGeneratedContent', 'advertising', 'healthOrWellnessTopics', 'seventeenPlus'):
            want[k] = False
        elif k in ('kidsAgeBand', 'ageRatingOverride', 'ageRatingOverrideV2', 'koreaAgeRatingOverride', 'developerAgeRatingInfoUrl'):
            continue
        else:
            want[k] = 'NONE'
    skipped = []
    for _ in range(12):  # drop any field Apple refuses and try again
        try:
            call('PATCH', f"/v1/ageRatingDeclarations/{decl['id']}", {'data': {'type': 'ageRatingDeclarations', 'id': decl['id'], 'attributes': want}})
            return f"set {len(want)} answers" + (f"; set these by hand: {', '.join(skipped)}" if skipped else '')
        except ApiError as e:
            bad = next((k for k in want if k in str(e)), None)
            if not bad:
                raise
            skipped.append(bad); want.pop(bad)
    raise ApiError('too many refused answers: ' + ', '.join(skipped))


@step('Price: free')
def price():
    points = call('GET', f'/v1/apps/{APP}/appPricePoints?filter[territory]=USA&limit=200')['data']
    free = next(p for p in points if float(p['attributes']['customerPrice']) == 0)
    call('POST', '/v1/appPriceSchedules', {
        'data': {'type': 'appPriceSchedules', 'relationships': {
            'app': rel('apps', APP), 'baseTerritory': rel('territories', 'USA'),
            'manualPrices': {'data': [{'type': 'appPrices', 'id': '${free}'}]}}},
        'included': [{'type': 'appPrices', 'id': '${free}', 'attributes': {'startDate': None},
                      'relationships': {'appPricePoint': rel('appPricePoints', free['id'])}}]})


@step('Availability: every country and region')
def availability():
    terr, url = [], '/v1/territories?limit=200'
    while url:
        page = call('GET', url)
        terr += [t['id'] for t in page['data']]
        url = page.get('links', {}).get('next')
    try:
        call('POST', '/v2/appAvailabilities', {
            'data': {'type': 'appAvailabilities', 'attributes': {'availableInNewTerritories': True}, 'relationships': {
                'app': rel('apps', APP),
                'territoryAvailabilities': {'data': [{'type': 'territoryAvailabilities', 'id': f'${{{t}}}'} for t in terr]}}},
            'included': [{'type': 'territoryAvailabilities', 'id': f'${{{t}}}', 'attributes': {'available': True},
                          'relationships': {'territory': rel('territories', t)}} for t in terr]})
    except ApiError as e:
        if '409' in str(e) and 'already' in str(e).lower():
            return 'already set'
        raise
    return f'{len(terr)} territories'


def withdraw_from_review():
    """Take a version out of App Review, but only the exact version named in listing.json's withdrawFromReview.

    Keyed on the version string, so a later submission of another version is never cancelled by mistake.
    Waits until Apple has released the version for editing, so the rest of the listing can fill it in."""
    target = L.get('withdrawFromReview')
    if not target:
        return
    vs = call('GET', f'/v1/apps/{APP}/appStoreVersions?filter[platform]=IOS&limit=20')['data']
    v = next((x for x in vs if x['attributes']['versionString'] == target), None)
    if not v:
        print(f'Withdraw: no version {target} found; nothing to do.')
        return
    state = v['attributes'].get('appStoreState')
    print(f'Withdraw: version {target} is {state}.')
    subs = call('GET', f'/v1/reviewSubmissions?filter[app]={APP}&filter[platform]=IOS&limit=20&include=items')
    active = [x for x in subs['data'] if x['attributes'].get('state') in ('READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES')]
    for sub in active:
        # Only a submission that carries this version.
        items = call('GET', f"/v1/reviewSubmissions/{sub['id']}/items?include=appStoreVersion&limit=50")
        ids = [(i.get('relationships', {}).get('appStoreVersion', {}).get('data') or {}).get('id') for i in items['data']]
        if v['id'] not in ids:
            continue
        a = sub['attributes']
        print(f"Withdraw: submission {sub['id']} is {a.get('state')}, submitted {a.get('submittedDate')}. Cancelling it.")
        call('PATCH', f"/v1/reviewSubmissions/{sub['id']}", {'data': {'type': 'reviewSubmissions', 'id': sub['id'], 'attributes': {'canceled': True}}})
    if not active:
        print('Withdraw: no active review submission found.')
    open_states = ('PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY')
    for _ in range(30):
        st = call('GET', f"/v1/appStoreVersions/{v['id']}")['data']['attributes'].get('appStoreState')
        if st in open_states:
            print(f'Withdraw: version {target} is now {st}, so it can be edited.')
            return
        print(f'Withdraw: waiting for Apple to release {target} (now {st})…', flush=True)
        time.sleep(20)
    print(f'Withdraw: {target} is still not editable after 10 minutes. Run this workflow again shortly.')


def editable_version():
    vs = call('GET', f'/v1/apps/{APP}/appStoreVersions?filter[platform]=IOS&limit=20')['data']
    open_states = ('PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY')
    v = next((x for x in vs if x['attributes'].get('appStoreState') in open_states or x['attributes'].get('appVersionState') in open_states), None)
    if v:
        return v
    return call('POST', '/v1/appStoreVersions', {'data': {'type': 'appStoreVersions', 'attributes': {'platform': 'IOS', 'versionString': VERSION},
                                                         'relationships': {'app': rel('apps', APP)}}})['data']


@step(f'Version number and copyright')
def version_fields(v):
    call('PATCH', f"/v1/appStoreVersions/{v['id']}", {'data': {'type': 'appStoreVersions', 'id': v['id'], 'attributes': {
        'versionString': VERSION, 'copyright': L['copyright']}}})
    return VERSION


@step('Build: newest processed upload of this version')
def attach_build(v):
    # Right after an upload, Apple takes 5–30 minutes to process the build: wait for it.
    for _ in range(45):
        builds = call('GET', f'/v1/builds?filter[app]={APP}&filter[preReleaseVersion.version]={VERSION}&sort=-uploadedDate&limit=10')['data']
        ok = [b for b in builds if b['attributes'].get('processingState') == 'VALID' and not b['attributes'].get('expired')]
        if ok or not any(b['attributes'].get('processingState') == 'PROCESSING' for b in builds) and builds:
            break
        print('Waiting for Apple to process the build…', flush=True); time.sleep(60)
    if not ok:
        states = ', '.join(b['attributes'].get('processingState', '?') for b in builds) or 'none uploaded'
        raise ApiError(f'no processed build of {VERSION} yet ({states}). Run this again once Apple has processed it.')
    b = ok[0]
    call('PATCH', f"/v1/appStoreVersions/{v['id']}/relationships/build", rel('builds', b['id']))
    return f"build {b['attributes']['version']}"


def version_localization(v):
    locs = call('GET', f"/v1/appStoreVersions/{v['id']}/appStoreVersionLocalizations")['data']
    return next((x for x in locs if x['attributes']['locale'] == L['locale']), locs[0])


@step('Description, keywords, promotional text, support and marketing URLs')
def version_text(loc):
    call('PATCH', f"/v1/appStoreVersionLocalizations/{loc['id']}", {'data': {'type': 'appStoreVersionLocalizations', 'id': loc['id'], 'attributes': {
        'description': L['description'], 'keywords': L['keywords'], 'promotionalText': L['promotionalText'],
        'supportUrl': L['supportUrl'], 'marketingUrl': L['marketingUrl']}}})


@step("What's New in This Version")
def whats_new(loc):
    # Apple accepts What's New only on an update, not on an app's first version, so it's sent on its own.
    if not L.get('whatsNew'):
        return 'none in listing.json'
    vs = call('GET', f'/v1/apps/{APP}/appStoreVersions?filter[platform]=IOS&limit=20')['data']
    if not any(x['attributes'].get('appStoreState') in ('READY_FOR_SALE', 'REPLACED_WITH_NEW_VERSION', 'REMOVED_FROM_SALE', 'DEVELOPER_REMOVED_FROM_SALE')
               for x in vs):
        return 'skipped: Apple allows What\'s New only once a version has been released'
    call('PATCH', f"/v1/appStoreVersionLocalizations/{loc['id']}", {'data': {'type': 'appStoreVersionLocalizations', 'id': loc['id'], 'attributes': {
        'whatsNew': L['whatsNew']}}})


@step('App Review contact and notes (add a phone number by hand)')
def review(v):
    attrs = dict(L['review'])
    try:
        d = call('GET', f"/v1/appStoreVersions/{v['id']}/appStoreReviewDetail")['data']
    except ApiError:
        d = None
    if d:
        call('PATCH', f"/v1/appStoreReviewDetails/{d['id']}", {'data': {'type': 'appStoreReviewDetails', 'id': d['id'], 'attributes': attrs}})
    else:
        call('POST', '/v1/appStoreReviewDetails', {'data': {'type': 'appStoreReviewDetails', 'attributes': attrs,
                                                            'relationships': {'appStoreVersion': rel('appStoreVersions', v['id'])}}})


def upload_set(loc, display, files):
    sets = call('GET', f"/v1/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets")['data']
    s = next((x for x in sets if x['attributes']['screenshotDisplayType'] == display), None)
    if not s:
        s = call('POST', '/v1/appScreenshotSets', {'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': display},
                                                          'relationships': {'appStoreVersionLocalization': rel('appStoreVersionLocalizations', loc['id'])}}})['data']
    existing = call('GET', f"/v1/appScreenshotSets/{s['id']}/appScreenshots")['data']
    want = [(n, hashlib.md5(open(os.path.join(SHOTS, n), 'rb').read()).hexdigest()) for n in files]
    have = [(x['attributes'].get('fileName'), x['attributes'].get('sourceFileChecksum')) for x in existing]
    # Keep an identical set unless Apple failed to process one; one still processing just needs time.
    if have == want and not any((x['attributes'].get('assetDeliveryState') or {}).get('state') == 'FAILED' for x in existing):
        return f'{len(files)} already uploaded'
    for old in existing:  # replace, don't pile up
        call('DELETE', f"/v1/appScreenshots/{old['id']}")
    for name in files:
        data = open(os.path.join(SHOTS, name), 'rb').read()
        shot = call('POST', '/v1/appScreenshots', {'data': {'type': 'appScreenshots', 'attributes': {'fileName': name, 'fileSize': len(data)},
                                                          'relationships': {'appScreenshotSet': rel('appScreenshotSets', s['id'])}}})['data']
        for op in shot['attributes']['uploadOperations']:
            part = data[op['offset']:op['offset'] + op['length']]
            req = urllib.request.Request(op['url'], data=part, method=op['method'],
                                         headers={h['name']: h['value'] for h in op.get('requestHeaders', [])})
            urllib.request.urlopen(req).read()
        call('PATCH', f"/v1/appScreenshots/{shot['id']}", {'data': {'type': 'appScreenshots', 'id': shot['id'], 'attributes': {
            'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}})
    return f'{len(files)} uploaded'


def submit_for_review(v):
    """Submit the version for App Review, only when listing.json's submitForReview names this exact version
    and every earlier step succeeded. Then report the state App Store Connect shows."""
    if L.get('submitForReview') != VERSION:
        return
    problems = [n for st, n, _ in results if st != 'OK']
    if problems:
        print('Submit: not submitted, because these steps need attention first: ' + '; '.join(problems))
        return
    subs = call('GET', f'/v1/reviewSubmissions?filter[app]={APP}&filter[platform]=IOS&limit=20')['data']
    has_version = lambda x: any((i.get('relationships', {}).get('appStoreVersion', {}).get('data') or {}).get('id') == v['id']
                                for i in call('GET', f"/v1/reviewSubmissions/{x['id']}/items?include=appStoreVersion&limit=50")['data'])
    for x in subs:
        st = x['attributes'].get('state')
        if st in ('WAITING_FOR_REVIEW', 'IN_REVIEW') and has_version(x):
            print(f"Submit: {VERSION} is already submitted ({st}).")
            return
    # After a rejection the submission stays open with "unresolved issues": the fixed version goes back in it.
    reopen = next((x for x in subs if x['attributes'].get('state') == 'UNRESOLVED_ISSUES' and has_version(x)), None)
    for _ in range(30):  # a cancelled submission must finish cancelling before a new one opens
        subs = call('GET', f'/v1/reviewSubmissions?filter[app]={APP}&filter[platform]=IOS&limit=20')['data']
        if not any(x['attributes'].get('state') in ('CANCELING', 'COMPLETING') for x in subs):
            break
        print('Submit: waiting for the earlier submission to finish cancelling…', flush=True); time.sleep(20)
    draft = reopen or next((x for x in subs if x['attributes'].get('state') == 'READY_FOR_REVIEW'), None)
    if reopen:
        print(f"Submit: resubmitting the submission with unresolved issues ({reopen['id']}).")
    if not draft:
        draft = call('POST', '/v1/reviewSubmissions', {'data': {'type': 'reviewSubmissions', 'attributes': {'platform': 'IOS'},
                                                               'relationships': {'app': rel('apps', APP)}}})['data']
    # Screenshots uploaded moments ago must finish processing before Apple accepts the version.
    loc = version_localization(v)
    for _ in range(90):
        pending = []
        for sset in call('GET', f"/v1/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets")['data']:
            for shot in call('GET', f"/v1/appScreenshotSets/{sset['id']}/appScreenshots")['data']:
                st = ((shot['attributes'].get('assetDeliveryState') or {}).get('state'))
                if st == 'FAILED':
                    errs = (shot['attributes'].get('assetDeliveryState') or {}).get('errors')
                    raise ApiError(f"Apple could not process screenshot {shot['attributes'].get('fileName')}: {errs}")
                if st != 'COMPLETE':
                    pending.append(f"{shot['attributes'].get('fileName')} {st}")
        if not pending:
            break
        print(f'Submit: waiting for Apple to process {len(pending)} screenshots ({pending[0]})…', flush=True); time.sleep(20)
    items = call('GET', f"/v1/reviewSubmissions/{draft['id']}/items?include=appStoreVersion&limit=50")['data']
    if not any((i.get('relationships', {}).get('appStoreVersion', {}).get('data') or {}).get('id') == v['id'] for i in items):
        for attempt in range(5):
            try:
                call('POST', '/v1/reviewSubmissionItems', {'data': {'type': 'reviewSubmissionItems', 'relationships': {
                    'reviewSubmission': rel('reviewSubmissions', draft['id']), 'appStoreVersion': rel('appStoreVersions', v['id'])}}})
                break
            except ApiError as e:
                if attempt == 4:
                    raise
                print(f'Submit: Apple not ready yet, trying again in a minute:\n{e}', flush=True); time.sleep(60)
    try:
        call('PATCH', f"/v1/reviewSubmissions/{draft['id']}", {'data': {'type': 'reviewSubmissions', 'id': draft['id'], 'attributes': {'submitted': True}}})
    except ApiError as e:
        if not reopen:
            raise
        # If Apple won't take the reopened submission back, cancel it and submit the version in a new one.
        print(f'Submit: the reopened submission was refused ({e}); submitting in a new one.', flush=True)
        call('PATCH', f"/v1/reviewSubmissions/{reopen['id']}", {'data': {'type': 'reviewSubmissions', 'id': reopen['id'], 'attributes': {'canceled': True}}})
        for _ in range(30):
            if call('GET', f"/v1/reviewSubmissions/{reopen['id']}")['data']['attributes'].get('state') not in ('CANCELING', 'UNRESOLVED_ISSUES'):
                break
            time.sleep(20)
        draft = call('POST', '/v1/reviewSubmissions', {'data': {'type': 'reviewSubmissions', 'attributes': {'platform': 'IOS'},
                                                               'relationships': {'app': rel('apps', APP)}}})['data']
        call('POST', '/v1/reviewSubmissionItems', {'data': {'type': 'reviewSubmissionItems', 'relationships': {
            'reviewSubmission': rel('reviewSubmissions', draft['id']), 'appStoreVersion': rel('appStoreVersions', v['id'])}}})
        call('PATCH', f"/v1/reviewSubmissions/{draft['id']}", {'data': {'type': 'reviewSubmissions', 'id': draft['id'], 'attributes': {'submitted': True}}})
    for _ in range(15):
        st = call('GET', f"/v1/reviewSubmissions/{draft['id']}")['data']['attributes'].get('state')
        vst = call('GET', f"/v1/appStoreVersions/{v['id']}")['data']['attributes'].get('appStoreState')
        print(f'Submit: submission is {st}; App Store Connect shows version {VERSION} as {vst}.', flush=True)
        if vst == 'WAITING_FOR_REVIEW' or st in ('WAITING_FOR_REVIEW', 'IN_REVIEW'):
            print(f'CONFIRMED: Cowdrey.MD {VERSION} is Waiting for Review.')
            return
        time.sleep(20)


if '--build-only' in sys.argv:
    # After an iPhone build: only move the version number and attach the new build. Text and screenshots are
    # left alone, so edits made by hand in App Store Connect are kept.
    try:
        v = editable_version()
    except ApiError as e:
        if 'current state' not in str(e):
            raise
        print(f'A version is in App Review, so build {VERSION} stays in TestFlight. Once that review is done, run this '
              'workflow again (or push any change to docs/app-store) to start the next App Store version with it.')
        sys.exit(0)
    version_fields(v)
    attach_build(v)
    for status, name, detail in results:
        print(f"[{status}] {name}" + (f" — {detail}" if detail else ''))
    sys.exit(0)

content_rights()
info = editable_app_info()
category(info)
info_text(info)
age_rating(info)
price()
availability()
withdraw_from_review()
v = editable_version()
version_fields(v)
attach_build(v)
loc = version_localization(v)
version_text(loc)
whats_new(loc)
review(v)
for display, files in L['screenshots'].items():
    step(f'Screenshots: {display}')(upload_set)(loc, display, files)
try:
    submit_for_review(v)
except ApiError as e:
    print(f'Submit: Apple refused the submission: {e}')

print('\nApp Store listing for Cowdrey.MD', VERSION)
for status, name, detail in results:
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ''))
print('\nStill to do in App Store Connect: App Privacy (choose "Data Not Collected"), a phone number for App Review, then Add for Review.')
sys.exit(0)
