"""Mac App Store signing and App Store Connect steps for .github/workflows/mac-app-store.yml.

  prepare OUT_DIR STATE_JSON   Makes throwaway signing material for this run through the App Store Connect API:
                               an Apple Distribution and a Mac Installer Distribution certificate (key and CSR made
                               here, so the private keys never leave the runner), and a MAC_APP_STORE provisioning
                               profile for com.bradcowdrey.cowdreymd. The certificates and profile an earlier run of
                               this workflow made (their IDs are in STATE_JSON, kept on the mac-app-store-log branch)
                               are revoked/deleted first, so the account never collects them; nothing else is touched.
                               Also makes sure the app record has a macOS version (adds the macOS platform).
  wait-build BUILD_NUMBER      Waits (bounded) until App Store Connect lists the uploaded macOS build.

Environment: APPLE_API_ISSUER, APPLE_API_KEY (key ID), P8 (private key text), VERSION (app version).
Never submits anything for review.
"""
import base64, json, os, secrets, sys, time, urllib.error, urllib.parse, urllib.request

import jwt
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

API = 'https://api.appstoreconnect.apple.com'
BUNDLE_ID = 'com.bradcowdrey.cowdreymd'
PROFILE_PREFIX = 'Cowdrey.MD Mac App Store CI'


def token():
    now = int(time.time())
    return jwt.encode({'iss': os.environ['APPLE_API_ISSUER'].strip(), 'iat': now, 'exp': now + 900, 'aud': 'appstoreconnect-v1'},
                      os.environ['P8'].replace('\r', '').strip(), algorithm='ES256',
                      headers={'kid': os.environ['APPLE_API_KEY'].strip(), 'typ': 'JWT'})


class ApiError(Exception):
    def __init__(self, msg, code):
        super().__init__(msg)
        self.code = code


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
        raise ApiError(f'{method} {path.split("?")[0]} -> HTTP {e.code}: {text}', e.code)


def log(*a):
    print(*a, flush=True)


def app_id():
    apps = call('GET', f'/v1/apps?filter[bundleId]={BUNDLE_ID}')['data']
    apps = [a for a in apps if a['attributes'].get('bundleId') == BUNDLE_ID]
    if not apps:
        sys.exit(f'No app with bundle ID {BUNDLE_ID} in App Store Connect.')
    return apps[0]['id']


def make_cert(kind, label, out_dir, password):
    """Creates a certificate of `kind` from a new key; writes OUT/label.p12 and returns (id, sha1, common name)."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    csr = (x509.CertificateSigningRequestBuilder()
           .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f'Cowdrey.MD CI {label}'),
                                    x509.NameAttribute(NameOID.COUNTRY_NAME, 'US')]))
           .sign(key, hashes.SHA256()))
    pem = csr.public_bytes(serialization.Encoding.PEM).decode()
    res = call('POST', '/v1/certificates', {'data': {'type': 'certificates', 'attributes': {'certificateType': kind, 'csrContent': pem}}})['data']
    der = base64.b64decode(res['attributes']['certificateContent'])
    cert = x509.load_der_x509_certificate(der)
    cn = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value
    sha1 = cert.fingerprint(hashes.SHA1()).hex().upper()
    # Legacy PKCS#12 encryption (3DES/SHA1): what `security import` on macOS reads reliably.
    enc = (serialization.PrivateFormat.PKCS12.encryption_builder().kdf_rounds(2048)
           .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(password.encode()))
    with open(os.path.join(out_dir, label + '.p12'), 'wb') as f:
        f.write(pkcs12.serialize_key_and_certificates(label.encode(), key, cert, None, enc))
    log(f'Created {kind} certificate "{cn}" (id {res["id"]}, expires {res["attributes"].get("expirationDate")})')
    return res['id'], sha1, cn


def list_certs():
    return call('GET', '/v1/certificates?limit=200&fields[certificates]=name,displayName,certificateType,expirationDate')['data']


def prepare(out_dir, state_path):
    os.makedirs(out_dir, exist_ok=True)
    state = {}
    if os.path.exists(state_path):
        try:
            state = json.load(open(state_path))
        except Exception:
            state = {}
    APP = app_id()
    log(f'App record: {APP}')

    # 1. Earlier runs' throwaway certificates and profiles (only the ones this workflow made, by ID).
    for cid in state.get('certificates', []):
        try:
            call('DELETE', f'/v1/certificates/{cid}')
            log(f'Revoked the previous run\'s certificate {cid}')
        except ApiError as e:
            log(f'Previous certificate {cid}: {e}' if e.code != 404 else f'Previous certificate {cid} is already gone')
    for p in call('GET', f'/v1/profiles?filter[name]={urllib.parse.quote(PROFILE_PREFIX)}&limit=200')['data']:
        if p['attributes']['name'].startswith(PROFILE_PREFIX):
            try:
                call('DELETE', f'/v1/profiles/{p["id"]}')
                log(f'Deleted the earlier profile "{p["attributes"]["name"]}"')
            except ApiError as e:
                log(f'Earlier profile {p["id"]}: {e}')

    # 2. The bundle ID (shared with the iPhone app: universal purchase).
    bids = [b for b in call('GET', f'/v1/bundleIds?filter[identifier]={BUNDLE_ID}&limit=50')['data'] if b['attributes']['identifier'] == BUNDLE_ID]
    if not bids:
        sys.exit(f'The bundle ID {BUNDLE_ID} is not registered (Certificates, Identifiers & Profiles).')
    bid = bids[0]
    log(f'Bundle ID {BUNDLE_ID}: id {bid["id"]}, platform {bid["attributes"].get("platform")}')

    # 3. New certificates for this run.
    password = secrets.token_hex(16)
    made = []
    certs = {}
    for kind, label in (('DISTRIBUTION', 'distribution'), ('MAC_INSTALLER_DISTRIBUTION', 'installer')):
        try:
            cid, sha1, cn = make_cert(kind, label, out_dir, password)
        except ApiError as e:
            existing = [f"{c['attributes'].get('name')} ({c['attributes'].get('certificateType')}, expires {c['attributes'].get('expirationDate', '')[:10]})"
                        for c in list_certs() if c['attributes'].get('certificateType') == kind]
            json.dump({'certificates': made}, open(state_path, 'w'))
            sys.exit(f'Apple refused a new {kind} certificate: {e}\nThe account already has: {"; ".join(existing) or "none listed"}.\n'
                     'OWNER: revoke one you no longer use at developer.apple.com > Certificates, Identifiers & Profiles > Certificates, then run this workflow again.')
        made.append(cid)
        certs[label] = (cid, sha1, cn)
    json.dump({'certificates': made}, open(state_path, 'w'))

    # 4. A Mac App Store profile with the new Apple Distribution certificate.
    name = f'{PROFILE_PREFIX} {os.environ.get("GITHUB_RUN_NUMBER", int(time.time()))}'
    try:
        prof = call('POST', '/v1/profiles', {'data': {'type': 'profiles', 'attributes': {'name': name, 'profileType': 'MAC_APP_STORE'},
                                                       'relationships': {'bundleId': {'data': {'type': 'bundleIds', 'id': bid['id']}},
                                                                         'certificates': {'data': [{'type': 'certificates', 'id': certs['distribution'][0]}]}}}})['data']
    except ApiError as e:
        sys.exit(f'Apple refused the Mac App Store provisioning profile: {e}\n'
                 f'OWNER: at developer.apple.com > Identifiers, open {BUNDLE_ID} and make sure macOS is enabled for it.')
    with open(os.path.join(out_dir, 'embedded.provisionprofile'), 'wb') as f:
        f.write(base64.b64decode(prof['attributes']['profileContent']))
    log(f'Created the provisioning profile "{name}" ({prof["attributes"].get("profileState")}, expires {prof["attributes"].get("expirationDate")})')

    env = os.environ.get('GITHUB_ENV')
    lines = [f'P12_PASSWORD={password}', f'DIST_SHA1={certs["distribution"][1]}', f'DIST_NAME={certs["distribution"][2]}',
             f'INSTALLER_SHA1={certs["installer"][1]}', f'INSTALLER_NAME={certs["installer"][2]}', f'ASC_APP_ID={APP}']
    if env:
        with open(env, 'a') as f:
            f.write('\n'.join(lines) + '\n')
    if os.environ.get('GITHUB_ACTIONS'):
        print(f'::add-mask::{password}')

    # 5. The macOS platform on the app record: a MAC_OS App Store version for this version number.
    version = os.environ['VERSION']
    vers = call('GET', f'/v1/apps/{APP}/appStoreVersions?filter[platform]=MAC_OS&limit=20')['data']
    if vers:
        log('macOS versions on the app record: ' + ', '.join(f"{v['attributes']['versionString']} ({v['attributes'].get('appStoreState') or v['attributes'].get('appVersionState')})" for v in vers))
    else:
        try:
            v = call('POST', '/v1/appStoreVersions', {'data': {'type': 'appStoreVersions', 'attributes': {'platform': 'MAC_OS', 'versionString': version},
                                                                'relationships': {'app': {'data': {'type': 'apps', 'id': APP}}}}})['data']
            log(f'Added the macOS platform: macOS version {version} created ({v["id"]}). Nothing is submitted.')
        except ApiError as e:
            log(f'Could not add the macOS platform through the API: {e}\n'
                'OWNER: App Store Connect > Apps > Cowdrey.MD > in the sidebar, click + next to the iOS app and choose macOS, '
                f'version {version}. Then run this workflow again.')


def wait_build(number):
    APP = app_id()
    for i in range(30):
        builds = call('GET', f'/v1/builds?filter[app]={APP}&filter[version]={number}&filter[preReleaseVersion.platform]=MAC_OS'
                             '&fields[builds]=version,processingState,uploadedDate&limit=5')['data']
        if builds:
            a = builds[0]['attributes']
            log(f'App Store Connect lists macOS build {a["version"]}: {a.get("processingState")} (uploaded {a.get("uploadedDate")})')
            if a.get('processingState') != 'PROCESSING' or i >= 10:
                return
        else:
            log(f'macOS build {number} not listed yet ({i + 1}/30)')
        time.sleep(60)
    log(f'macOS build {number} still not listed after 30 minutes; Apple usually emails if processing failed.')


if __name__ == '__main__':
    if sys.argv[1] == 'prepare':
        prepare(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == 'wait-build':
        wait_build(sys.argv[2])
