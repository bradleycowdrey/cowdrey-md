#!/usr/bin/env python3
"""Puts an Android app on Google Play: its store listing (the words and pictures in docs/play) and, given a signed
App Bundle, a release on a testing track (Play's closed test by default). The same script is used by each of
Bradley Cowdrey's apps, like testflight_public.py for the iPhone apps.

Environment:
  PLAY_SERVICE_ACCOUNT_JSON  the Google Cloud service account's JSON key (a GitHub secret). Without it nothing runs.
  PLAY_PACKAGE               the app's package name, e.g. com.bradcowdrey.bearings
  PLAY_AAB                   the signed .aab to release (optional: without it only the listing is updated)
  PLAY_TRACK                 'alpha' is Play's closed test (default); also 'internal', 'beta', 'production'
  PLAY_LISTING_DIR           the listing folder (default docs/play): listing.json, icon.png (512 x 512),
                             feature-graphic.png (1024 x 500) and phone-1.png, phone-2.png, ... (2 to 8)
  PLAY_RELEASE_NAME          the release's name in Play Console (optional; default: the version code)
  PLAY_RELEASE_NOTES         "What's new" for testers (optional; up to 500 characters)

Each step prints [OK], [SKIP] or [NEEDS YOU]. Steps that need Bradley in Play Console (creating the app, inviting
the service account, the first rollout of a new app) are reported as GitHub warnings and don't fail the build.
"""
import glob, json, os, sys, time, urllib.error, urllib.parse, urllib.request

import jwt

API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'
UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/'
LIMITS = {'title': 30, 'shortDescription': 80, 'fullDescription': 4000}


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(f'{status}: {message}')
        self.status, self.message = status, message


def say(tag, text):
    print(f'[{tag}] {text}', flush=True)
    if tag == 'NEEDS YOU':
        print(f'::warning title=Google Play::{text}', flush=True)


def access_token(sa):
    now = int(time.time())
    uri = sa.get('token_uri') or 'https://oauth2.googleapis.com/token'
    assertion = jwt.encode({'iss': sa['client_email'], 'scope': 'https://www.googleapis.com/auth/androidpublisher',
                            'aud': uri, 'iat': now, 'exp': now + 3600}, sa['private_key'], algorithm='RS256')
    body = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': assertion}).encode()
    with urllib.request.urlopen(urllib.request.Request(uri, data=body, method='POST'), timeout=60) as r:
        return json.load(r)['access_token']


class Play:
    def __init__(self, token, package):
        self.token, self.package = token, package

    def call(self, method, url, body=None, data=None, ctype='application/json'):
        headers = {'Authorization': 'Bearer ' + self.token}
        if body is not None:
            data = json.dumps(body).encode()
        if data is not None:
            headers['Content-Type'] = ctype
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=900) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8', 'replace')
            try:
                msg = json.loads(raw)['error']['message']
            except Exception:
                msg = raw[:400]
            raise ApiError(e.code, msg)

    def edit_url(self, edit, path=''):
        return f'{API}{self.package}/edits/{edit}{path}'

    def upload_url(self, edit, path):
        return f'{UPLOAD}{self.package}/edits/{edit}{path}?uploadType=media'


def load_listing(folder):
    path = os.path.join(folder, 'listing.json')
    if not os.path.exists(path):
        return None
    listing = json.load(open(path))
    for key, limit in LIMITS.items():
        if len(listing.get(key, '')) > limit:
            sys.exit(f'{path}: {key} is {len(listing[key])} characters; Play allows {limit}')
    images = {
        'icon': [os.path.join(folder, 'icon.png')],
        'featureGraphic': [os.path.join(folder, 'feature-graphic.png')],
        'phoneScreenshots': sorted(glob.glob(os.path.join(folder, 'phone-*.png')), key=lambda p: int(''.join(c for c in os.path.basename(p) if c.isdigit()) or 0)),
    }
    images = {k: [f for f in v if os.path.exists(f)] for k, v in images.items()}
    return listing, images


def publish(play, status, listing, aab, track):
    edit = play.call('POST', f'{API}{play.package}/edits', {})['id']
    if listing:
        text, images = listing
        lang = text.get('language', 'en-US')
        details = {'defaultLanguage': lang, 'contactEmail': text['contactEmail']}
        if text.get('contactWebsite'):
            details['contactWebsite'] = text['contactWebsite']
        play.call('PUT', play.edit_url(edit, '/details'), details)
        play.call('PUT', play.edit_url(edit, f'/listings/{lang}'), {'language': lang, 'title': text['title'],
                  'shortDescription': text['shortDescription'], 'fullDescription': text['fullDescription']})
        for kind, files in images.items():
            if not files:
                continue
            play.call('DELETE', play.edit_url(edit, f'/listings/{lang}/{kind}'))
            for f in files:
                play.call('POST', play.upload_url(edit, f'/listings/{lang}/{kind}'), data=open(f, 'rb').read(), ctype='image/png')
        say('OK', f'Store listing: {text["title"]} ({lang}), ' + ', '.join(f'{len(v)} {k}' for k, v in images.items() if v))
    version = None
    if aab:
        try:
            version = play.call('POST', play.upload_url(edit, '/bundles'), data=open(aab, 'rb').read(),
                                ctype='application/octet-stream')['versionCode']
            say('OK', f'App Bundle uploaded: version code {version}')
        except ApiError as e:
            if 'already been used' in e.message or 'versionCode' in e.message:
                say('SKIP', f'This App Bundle\'s version code is already on Play ({e.message}). Play takes a new build when the version code goes up.')
            else:
                raise
    if version:
        release = {'name': os.environ.get('PLAY_RELEASE_NAME') or str(version), 'versionCodes': [str(version)], 'status': status}
        notes = (os.environ.get('PLAY_RELEASE_NOTES') or '').strip()
        if notes:
            release['releaseNotes'] = [{'language': listing[0].get('language', 'en-US') if listing else 'en-US', 'text': notes[:500]}]
        play.call('PUT', play.edit_url(edit, f'/tracks/{track}'), {'track': track, 'releases': [release]})
    try:
        play.call('POST', play.edit_url(edit, ':commit'))
    except ApiError as e:
        if 'changesNotSentForReview' not in e.message:
            raise
        play.call('POST', play.edit_url(edit, ':commit') + '?changesNotSentForReview=true')
        say('NEEDS YOU', 'Saved in Play Console but not sent for review: Play Console, Publishing overview, Send changes for review.')
    if version:
        say('OK', f'Release {version} on the {track} track ({status})' + (
            '. The app is still a draft in Play Console: finish its setup there, then roll out this release.' if status == 'draft' else ''))
        if status == 'draft':
            say('NEEDS YOU', f'Finish the app\'s setup in Play Console (App content, store settings), then roll out release {version} on the closed test.')


def main():
    raw = (os.environ.get('PLAY_SERVICE_ACCOUNT_JSON') or '').strip()
    if not raw:
        say('SKIP', 'No PLAY_SERVICE_ACCOUNT_JSON secret: nothing sent to Google Play.')
        return
    package = os.environ['PLAY_PACKAGE']
    track = os.environ.get('PLAY_TRACK') or 'alpha'
    aab = (os.environ.get('PLAY_AAB') or '').strip() or None
    if aab and not os.path.exists(aab):
        sys.exit(f'PLAY_AAB {aab} does not exist')
    listing = load_listing(os.environ.get('PLAY_LISTING_DIR') or 'docs/play')
    sa = json.loads(raw)
    print(f'Google Play: {package} as {sa.get("client_email")}', flush=True)
    play = Play(access_token(sa), package)
    try:
        try:
            publish(play, 'completed', listing, aab, track)
        except ApiError as e:
            if 'draft' not in e.message.lower():
                raise
            # A new app is a draft until its setup in Play Console is finished; its releases must be drafts too.
            say('SKIP', f'Play says the app is still a draft ({e.message}); trying again as a draft release.')
            publish(play, 'draft', listing, aab, track)
    except ApiError as e:
        if e.status == 404 or 'not found' in e.message.lower():
            # Play Console gives a new app its package name from the first App Bundle uploaded to it, by hand.
            say('NEEDS YOU', f'Play doesn\'t know {package} yet. In Play Console: Create app, then upload this app\'s first signed App Bundle by hand (Testing, Closed testing, Create release); after that, this step updates it. ({e.message})')
        elif e.status in (401, 403):
            say('NEEDS YOU', f'Play Console, Users and permissions: invite {sa.get("client_email")} with permission to release to testing tracks and manage the store listing for this app. ({e.message})')
        elif 'first' in e.message.lower() and 'upload' in e.message.lower():
            say('NEEDS YOU', f'Play needs this app\'s first App Bundle uploaded by hand in Play Console (Testing, Closed testing, Create release). ({e.message})')
        else:
            raise


if __name__ == '__main__':
    main()
