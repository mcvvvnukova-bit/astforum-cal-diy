import sys, json, ssl, email.parser, email.policy
sys.path.insert(0, '/opt/astforum-mail')
from verify import LocalIMAP, secret, HOST

marker = sys.argv[1]
with LocalIMAP(HOST, 993, ssl_context=ssl.create_default_context(), timeout=15) as imap:
    assert imap.login('notifications@astforum.ru', secret('notifications_password'))[0] == 'OK'
    assert imap.select('INBOX', readonly=True)[0] == 'OK'
    status, ids = imap.search(None, 'SUBJECT', marker)
    assert status == 'OK'
    matches = []
    for uid in ids[0].split():
        status, parts = imap.fetch(uid, '(BODY.PEEK[])')
        assert status == 'OK'
        raw = b''.join(part[1] for part in parts if isinstance(part, tuple))
        message = email.parser.BytesParser(policy=email.policy.default).parsebytes(raw)
        calendars = [p.get_content() for p in message.walk() if p.get_content_type() == 'text/calendar']
        confirmed = any('STATUS:CONFIRMED' in c and 'DTSTART:20260918T100000Z' in c for c in calendars)
        matches.append({'messageId': str(message['Message-ID']), 'subject': str(message['Subject']), 'confirmedCalendarWithCorrectTime': confirmed})
    assert any(m['confirmedCalendarWithCorrectTime'] for m in matches), 'No received confirmation calendar message'
    print(json.dumps({'result': 'PASS received attendee confirmation via IMAPS', 'messages': matches}, ensure_ascii=False))
