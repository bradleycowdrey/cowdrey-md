"""Keep a public TestFlight link for Cowdrey.MD, so iPhone and iPad users can install it before the App Store release.

Through the App Store Connect API this:
  1. fills in the TestFlight test information (description, feedback email, links) and the beta App Review
     contact (copied from the App Store review contact, so the phone number is never printed or stored here);
  2. makes sure an external tester group "Public" exists with its public link turned on;
  3. adds the newest processed build to that group, with "What to Test" notes;
  4. submits that build for beta App Review if it hasn't been reviewed yet (later builds of an approved version
     are usually approved at once);
  5. prints the public link and the review state.
Environment: APPLE_API_ISSUER, APPLE_API_KEY (key ID), P8 (private key text).
"""
import json, os, sys, time, urllib.error, urllib.request

import jwt

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
L = json.load(open(os.path.join(ROOT, 'docs', 'app-store', 'listing.json')))
VERSION = json.load(open(os.path.join(ROOT, 'desktop', 'src-tauri', 'tauri.conf.json')))['version']
API = 'https://api.appstoreconnect.apple.com'
GROUP = 'Public'
DESCRIPTION = ('Cowdrey.MD is a free Markdown editor that feels like Docs and Word: write in plain text and see a clean, '
               'printable page. On iPhone and iPad it works like Pages: read the page, tap Edit to write. This TestFlight '
               'build is the same app that is on its way to the App Store.')
WHAT_TO_TEST = ('Cowdrey.MD ' + VERSION + '. Try writing and formatting, Open… a file from Files or iCloud Drive and save '
                'back to it, a sync folder, version history, and exporting to PDF and Word. Send feedback from TestFlight '
                'or to legal@bradcowdrey.com.')


def token():
    now = int(time.time())
    return jwt.encode({'iss': os.environ['APPLE_API_ISSUER'].strip(), 'iat': now, 'exp': now + 900, 'aud': 'appstoreconnect-v1'},
                      os.environ['P8'].replace('\r', '').strip(), algorithm='ES256',
                      headers={'kid': os.environ['APPLE_API_KEY'].strip(), 'typ': 'JWT'})


class ApiError(Exception):
    pass


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
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


def rel(t, i):
    return {'data': {'type': t, 'id': i}}


def step(name, fn):
    try:
        out = fn()
        print(f'[OK] {name}' + (f' — {out}' if isinstance(out, str) and out else ''), flush=True)
        return out
    except Exception as e:
        print(f'[NEEDS YOU] {name} — {e}', flush=True)
        return None


app = call('GET', f"/v1/apps?filter[bundleId]={L['bundleId']}")['data'][0]
APP = app['id']
print(f"App: {app['attributes']['name']} ({APP}), version {VERSION}")


def test_information():
    locs = call('GET', f'/v1/apps/{APP}/betaAppLocalizations')['data']
    attrs = {'description': DESCRIPTION, 'feedbackEmail': L['review']['contactEmail'],
             'marketingUrl': L['marketingUrl'], 'privacyPolicyUrl': L['privacyPolicyUrl']}
    loc = next((x for x in locs if x['attributes']['locale'] == L['locale']), None)
    if loc:
        call('PATCH', f"/v1/betaAppLocalizations/{loc['id']}", {'data': {'type': 'betaAppLocalizations', 'id': loc['id'], 'attributes': attrs}})
    else:
        call('POST', '/v1/betaAppLocalizations', {'data': {'type': 'betaAppLocalizations', 'attributes': dict(attrs, locale=L['locale']),
                                                          'relationships': {'app': rel('apps', APP)}}})
    return 'description, feedback email, links'


def review_contact():
    # Copy the contact (with the phone number added by hand in App Store Connect) from the newest App Store version.
    phone = None
    for v in call('GET', f'/v1/apps/{APP}/appStoreVersions?filter[platform]=IOS&limit=10')['data']:
        try:
            d = call('GET', f"/v1/appStoreVersions/{v['id']}/appStoreReviewDetail")['data']
        except ApiError:
            continue
        if d and d['attributes'].get('contactPhone'):
            phone = d['attributes']['contactPhone']
            break
    r = L['review']
    attrs = {'contactFirstName': r['contactFirstName'], 'contactLastName': r['contactLastName'], 'contactEmail': r['contactEmail'],
             'demoAccountRequired': False, 'notes': r['notes'][:4000]}
    if phone:
        attrs['contactPhone'] = phone
    d = call('GET', f'/v1/apps/{APP}/betaAppReviewDetail')['data']
    call('PATCH', f"/v1/betaAppReviewDetails/{d['id']}", {'data': {'type': 'betaAppReviewDetails', 'id': d['id'], 'attributes': attrs}})
    return 'contact copied from the App Store review contact' + ('' if phone else ' (no phone number found: add one in TestFlight → Test Information)')


def newest_build():
    for _ in range(45):
        bs = call('GET', f'/v1/builds?filter[app]={APP}&filter[preReleaseVersion.version]={VERSION}&sort=-uploadedDate&limit=10')['data']
        ok = [b for b in bs if b['attributes'].get('processingState') == 'VALID' and not b['attributes'].get('expired')]
        if ok:
            return ok[0]
        if not any(b['attributes'].get('processingState') == 'PROCESSING' for b in bs):
            raise ApiError(f'no processed build of {VERSION}')
        print('Waiting for Apple to process the build…', flush=True)
        time.sleep(60)
    raise ApiError('the build is still processing; run this again later')


def public_group():
    gs = call('GET', f'/v1/betaGroups?filter[app]={APP}&limit=50')['data']
    g = next((x for x in gs if x['attributes']['name'] == GROUP and not x['attributes'].get('isInternalGroup')), None)
    attrs = {'publicLinkEnabled': True, 'publicLinkLimitEnabled': False, 'feedbackEnabled': True}
    if g:
        g = call('PATCH', f"/v1/betaGroups/{g['id']}", {'data': {'type': 'betaGroups', 'id': g['id'], 'attributes': attrs}})['data']
    else:
        g = call('POST', '/v1/betaGroups', {'data': {'type': 'betaGroups', 'attributes': dict(attrs, name=GROUP),
                                                    'relationships': {'app': rel('apps', APP)}}})['data']
    return g


def what_to_test(b):
    locs = call('GET', f"/v1/builds/{b['id']}/betaBuildLocalizations")['data']
    loc = next((x for x in locs if x['attributes']['locale'] == L['locale']), None)
    if loc:
        call('PATCH', f"/v1/betaBuildLocalizations/{loc['id']}", {'data': {'type': 'betaBuildLocalizations', 'id': loc['id'], 'attributes': {'whatsNew': WHAT_TO_TEST}}})
    else:
        call('POST', '/v1/betaBuildLocalizations', {'data': {'type': 'betaBuildLocalizations', 'attributes': {'locale': L['locale'], 'whatsNew': WHAT_TO_TEST},
                                                            'relationships': {'build': rel('builds', b['id'])}}})
    return 'set'


step('TestFlight test information', test_information)
step('Beta App Review contact', review_contact)
build = step('Newest processed build', newest_build)
if build:
    print(f"     build {build['attributes']['version']}, uploaded {build['attributes']['uploadedDate']}")
group = step(f'External group "{GROUP}" with a public link', public_group)
if build:
    step('What to Test', lambda: what_to_test(build))
if build and group:
    step(f"Add build {build['attributes']['version']} to the group",
         lambda: call('POST', f"/v1/betaGroups/{group['id']}/relationships/builds", {'data': [{'type': 'builds', 'id': build['id']}]}) and None)

    def submit():
        try:
            s = call('GET', f"/v1/builds/{build['id']}/betaAppReviewSubmission")['data']
        except ApiError:
            s = None
        if not s:
            s = call('POST', '/v1/betaAppReviewSubmissions', {'data': {'type': 'betaAppReviewSubmissions', 'relationships': {'build': rel('builds', build['id'])}}})['data']
        return s['attributes'].get('betaReviewState')
    step('Beta App Review', submit)

    def state():
        d = call('GET', f"/v1/builds/{build['id']}/buildBetaDetail")['data']['attributes']
        return f"external testing: {d.get('externalBuildState')}"
    step('Build state', state)
    g = call('GET', f"/v1/betaGroups/{group['id']}")['data']['attributes']
    print(f"\nPUBLIC LINK: {g.get('publicLink') or '(not issued yet: Apple issues it once a build has passed beta review)'}")
