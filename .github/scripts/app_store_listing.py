"""Fill in the Cowdrey.MD App Store listing through the App Store Connect API.

Reads docs/app-store/listing.json and the screenshots beside it. Sets the category, content rights,
age rating, price (free), availability, the version's text and screenshots, App Review details, and
attaches the newest processed build for the version in tauri.conf.json. It never submits for review:
that stays a person's decision in App Store Connect.

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
            text = '; '.join(f"{x.get('title')}: {x.get('detail')}" for x in json.loads(text)['errors'])
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
    for old in call('GET', f"/v1/appScreenshotSets/{s['id']}/appScreenshots")['data']:  # replace, don't pile up
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


content_rights()
info = editable_app_info()
category(info)
info_text(info)
age_rating(info)
price()
availability()
v = editable_version()
version_fields(v)
attach_build(v)
loc = version_localization(v)
version_text(loc)
review(v)
for display, files in L['screenshots'].items():
    step(f'Screenshots: {display}')(upload_set)(loc, display, files)

print('\nApp Store listing for Cowdrey.MD', VERSION)
for status, name, detail in results:
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ''))
print('\nStill to do in App Store Connect: App Privacy (choose "Data Not Collected"), a phone number for App Review, then Add for Review.')
sys.exit(0)
