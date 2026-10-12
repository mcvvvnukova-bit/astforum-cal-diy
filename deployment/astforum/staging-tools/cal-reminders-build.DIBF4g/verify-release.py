import json, pathlib, re, subprocess, sys

revision = sys.argv[1] if len(sys.argv) > 1 else 'e62aef037860a2ff393a6a131a226bd7c00b4114'
release = pathlib.Path('/opt/astforum-cal-diy/releases') / revision
backup = pathlib.Path((release / 'backup.path').read_text().strip())
manifest = json.loads(subprocess.check_output(['docker','exec','astforum-cal-diy-web-1','cat','/calcom/reminder-fixtures-20260930.json'],text=True))
fixture_ids = [fixture['id'] for fixture in manifest['fixtures']]
where_ids = ','.join(str(int(value)) for value in fixture_ids)
query = '''SELECT COALESCE(json_agg(t),'[]') FROM (SELECT id, "referenceUid", attempts, "lastError", "succeededAt", payload::jsonb->>'bookingId' AS booking_id, payload::jsonb->>'minutesBefore' AS minutes_before, payload::jsonb->>'state' AS state FROM "Task" WHERE type='sendBookingReminder' AND (payload::jsonb->>'bookingId')::int IN (%s) ORDER BY "createdAt") t;''' % where_ids
tasks = json.loads(subprocess.check_output(['docker','exec','astforum-cal-diy-database-1','psql','-U','caldiy','-d','caldiy','-At','-c',query],text=True))
accepted = [task for task in tasks if task['state'] == 'smtp_accepted']
assert len(accepted) == 3, accepted
assert sorted(int(task['minutes_before']) for task in accepted) == [15,60,1440]
assert all(task['attempts'] == 1 for task in accepted)
manifest_by_id = {fixture['id']: fixture for fixture in manifest['fixtures']}
for fixture in manifest['fixtures']:
 matched = [task for task in tasks if int(task['booking_id']) == fixture['id']]
 if fixture['kind'] in ('cancelled','moved'):
  assert matched and all(task['state'] == 'skipped' for task in matched), matched
 if fixture['kind'] == 'late': assert not matched, matched
logs = subprocess.check_output(['docker','logs','--since',manifest['createdAt'],'astforum-mail-stalwart-1'],stderr=subprocess.STDOUT,text=True)
mail_evidence = []
for task in accepted:
 message_id = 'booking-reminder-'+task['referenceUid']+'@cal.astforum.ru'
 mail_evidence.append({'minutesBefore':int(task['minutes_before']),'bookingId':int(task['booking_id']),'expectedMessageId':message_id,'taskState':task['state'],'attempts':task['attempts']})
submissions = [line for line in logs.splitlines() if 'queue.authenticated-message-queued' in line and 'from = "notifications@astforum.ru"' in line and 'to = ["mc.vvvnukova@gmail.com"]' in line]
queue_ids = sorted(set(re.findall(r'queueId\s*=\s*(\d+)', '\n'.join(submissions))))
assert len(queue_ids) == 3, {'queueIds':queue_ids,'submissions':submissions}
delivery_queues = []
for queue_id in queue_ids:
 queue_lines = [line for line in logs.splitlines() if re.search(r'queueId\s*=\s*'+queue_id+r'\b',line)]
 delivered = [line for line in queue_lines if 'delivery.delivered' in line]
 completed = [line for line in queue_lines if 'delivery.completed' in line]
 assert len(delivered) == 1 and completed, {'queueId':queue_id,'lines':queue_lines}
 assert '250' in delivered[0] and 'gmail' in '\n'.join(queue_lines).lower(), queue_lines
 delivery_queues.append({'queueId':queue_id,'deliveryEvidence':delivered+completed})
neighbors = json.loads((backup / 'neighbors.before.json').read_text())
unchanged = []
for previous in neighbors:
 current = json.loads(subprocess.check_output(['docker','inspect',previous['name']],text=True))[0]
 assert current['Id'] == previous['id'] and current['State']['StartedAt'] == previous['startedAt'], previous['name']
 unchanged.append(previous['name'])
before_bookings = json.loads((backup / 'bookings.before.json').read_text())
original_ids = ','.join(str(int(row['id'])) for row in before_bookings)
query = '''SELECT COALESCE(json_agg(t),'[]') FROM (SELECT id, uid, status, "startTime", "endTime", "updatedAt", "eventTypeId", rescheduled FROM "Booking" WHERE id IN (%s) ORDER BY id) t;''' % original_ids
current_bookings = json.loads(subprocess.check_output(['docker','exec','astforum-cal-diy-database-1','psql','-U','caldiy','-d','caldiy','-At','-c',query],text=True))
assert current_bookings == before_bookings
web = json.loads(subprocess.check_output(['docker','inspect','astforum-cal-diy-web-1'],text=True))[0]
assert web['State']['Health']['Status'] == 'healthy'
assert web['Config']['Labels']['org.opencontainers.image.revision'] == revision
worker = json.loads(subprocess.check_output(['docker','inspect','astforum-cal-diy-reminder-worker-1'],text=True))[0]
assert worker['State']['Running'] and not worker['HostConfig']['PortBindings']
result = {'sourceRevision':revision,'image':web['Config']['Image'],'imageId':web['Image'],'recipient':'mc.vvvnukova@gmail.com','createdAt':manifest['createdAt'],'backup':str(backup),'authenticatedCron':True,'unauthorizedStatuses':manifest['authStatuses'],'messages':mail_evidence,'deliveryQueues':delivery_queues,'correlation':'Stalwart INFO omits Message-ID; three submissions to the sole test recipient in the task acceptance window, with three matching completed Gmail queues. Expected Message-IDs are recorded separately.','cancelledSkipped':True,'movedSkipped':True,'lateNotScheduled':True,'unchangedNeighbors':len(unchanged),'unchangedOriginalBookings':len(before_bookings),'webHealth':'healthy','workerRunning':True,'workerPublishedPorts':False}
(release / 'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
