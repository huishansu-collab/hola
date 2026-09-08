#!/usr/bin/env python3
"""Adapted from full-duplex-case-builder validator: adds world signals and exact external event times."""
import json
import sys
from collections import defaultdict
from pathlib import Path


def validate(case, timeline):
    errors = []

    def check(ok, message):
        if not ok:
            errors.append(message)

    def ms(value):
        return type(value) is int and value >= 0

    def interval(item, label, duration):
        a, b = item.get('start_at_ms'), item.get('end_at_ms')
        good = ms(a) and ms(b) and a < b <= duration
        check(good, f'{label}: invalid or out-of-range interval')
        return good

    try:
        duration = case['meta_data']['media']['audio']['duration_ms']
        check(ms(duration) and duration > 0, 'Meta audio duration_ms must be a positive integer')
        if not ms(duration) or duration <= 0:
            return errors
        check(timeline['duration_ms'] == duration, 'Meta and timeline durations differ')
        check(timeline['timing_status'] in ('planned', 'aligned', 'measured'), 'Invalid timing_status')
        channels = case['meta_data']['media']['audio']['tracks']
        check(channels == [{'track_ref': 'Channel 1', 'role': 'user'}, {'track_ref': 'Channel 2', 'role': 'assistant'}], 'Audio channel roles differ from default contract')
        utterances = case['utterances']
        by_id = {}
        starts = []
        for u in utterances:
            uid = u['id']
            check(isinstance(uid, str) and uid and uid not in by_id, f'Duplicate/invalid utterance ID: {uid}')
            by_id[uid] = u
            check(u['speaker'] in ('user', 'assistant', 'third_party'), f'{uid}: invalid speaker')
            check(isinstance(u['speaker_id'], str) and bool(u['speaker_id']), f'{uid}: missing speaker_id')
            check(isinstance(u['text'], str) and bool(u['text']), f'{uid}: empty text')
            check('[丢弃' not in u['text'] and 'sample_seg_id' not in u, f'{uid}: contains UI discard marker or sample_seg_id')
            interval(u, uid, duration)
            if ms(u.get('start_at_ms')):
                starts.append(u['start_at_ms'])
        check(starts == sorted(starts), 'Utterances must be sorted by start time')
        definitions = case['static_context']['tools']
        defined = []
        for tool in definitions:
            check(tool['type'] == 'function', 'Invalid tool definition type')
            f = tool['function']
            defined.append(f['name'])
            params = f['parameters']
            check(params['type'] == 'object', f"{f['name']}: parameters must be an object")
            check(set(params.get('required', [])) <= set(params.get('properties', {})), f"{f['name']}: required field absent from properties")
        check(len(defined) == len(set(defined)), 'Duplicate tool definitions')
        events = case['events']
        event_groups = defaultdict(list)
        times, used = [], set()
        for event in events:
            eid = event['event_id']
            check(isinstance(eid, str) and bool(eid), 'Invalid event_id')
            check(event['event_type'] in ('function_call', 'backend_call', 'memory_call', 'memory_call_fast', 'ui_event', 'payment_event', 'world_event'), f'{eid}: invalid event_type')
            if event['event_type'] in ('ui_event', 'payment_event', 'world_event'):
                check(not event.get('tool_name'), f'{eid}: UI/payment signals are not AI tool calls')
                check(isinstance(event.get('context'), dict), f'{eid}: missing external event context')
            t = event['time_at_ms']
            check(ms(t) and t <= duration, f'{eid}: invalid event time')
            if ms(t):
                times.append(t)
            if event.get('tool_name'):
                used.add(event['tool_name'])
            check(any(k in event for k in ('query', 'results', 'result', 'context')), f'{eid}: event has no payload')
            event_groups[eid].append(event)
        check(times == sorted(times), 'Events must be sorted by time')
        check(set(defined) == used, 'Meta tools must exactly match the Case event tool names')
        for eid, group in event_groups.items():
            check(len({e.get('tool_name') for e in group}) <= 1, f'{eid}: reused across different tools')
            requests = [e for e in group if 'query' in e]
            results = [e for e in group if 'results' in e or 'result' in e]
            check(len(requests) <= 1 and len(results) <= 1, f'{eid}: multiple calls share one ID')
            if requests and results:
                check(requests[0]['time_at_ms'] <= results[0]['time_at_ms'], f'{eid}: result precedes request')
        for field in ('fdx_annotation', 'emotion_annotation', 'paralinguistic_annotation', 'custom_annotation'):
            check(isinstance(case[field], list), f'{field} must be an array')
        for annotation in case['fdx_annotation']:
            check(annotation['role'] in ('user', 'assistant', 'third_party'), 'Invalid annotation role')
            check('打断' not in annotation['fdx_type'], 'Interruption must not be in fdx_annotation')
            interval(annotation, 'Annotation', duration)
        clip_ids, track_ids, speech_refs = set(), set(), []
        for track in timeline['tracks']:
            tid = track['id']
            check(tid not in track_ids, f'Duplicate track ID {tid}')
            track_ids.add(tid)
            lanes = defaultdict(list)
            for clip in track['clips']:
                cid = clip['id']
                check(cid not in clip_ids, f'Duplicate clip ID {cid}')
                clip_ids.add(cid)
                if not interval(clip, cid, duration):
                    continue
                a, b = clip['start_at_ms'], clip['end_at_ms']
                if tid not in ('user', 'control', 'world') and clip['kind'] != 'device_state':
                    check(a % 400 == 0, f'{cid}: non-user start must use 400ms grid')
                lanes[clip.get('lane', 0)].append((a, b, cid))
                if clip['kind'] == 'fade_stop':
                    check(b - a >= 400, f'{cid}: fade control must span at least 400ms')
                    stop = clip.get('stop_at_ms')
                    check(ms(stop) and a <= stop <= b, f'{cid}: exact stop must fall within control window')
                if clip['kind'] == 'speech':
                    uid = clip['utterance_id']
                    speech_refs.append(uid)
                    check(uid in by_id, f'{cid}: missing utterance {uid}')
                    if uid in by_id:
                        u = by_id[uid]
                        check((a, b) == (u['start_at_ms'], u['end_at_ms']), f'{cid}: speech differs from utterance timing')
                        check((tid == 'assistant') == (u['speaker'] == 'assistant'), f'{cid}: speaker/track mismatch')
                    if 'source_duration_ms' in clip:
                        check(abs(clip['source_duration_ms'] - (b-a)) <= 1, f'{cid}: stretched or truncated source duration')
            for lane, clips in lanes.items():
                clips.sort()
                for left, right in zip(clips, clips[1:]):
                    check(left[1] <= right[0], f'{tid}/{lane}: overlapping clips {left[2]} and {right[2]}')
        check(len(speech_refs) == len(set(speech_refs)) and set(speech_refs) == set(by_id), 'Each utterance must map to one speech clip')
        for link in timeline['response_links']:
            u, a = by_id[link['user_id']], by_id[link['assistant_id']]
            check(u['speaker'] != 'assistant' and a['speaker'] == 'assistant', 'Invalid response link roles')
            if link.get('allow_overlap'):
                check(bool(link.get('reason')), 'Response overlap exception needs a reason')
            else:
                check(a['start_at_ms'] >= u['end_at_ms']+400, 'Assistant responds before the 400ms gap')
        for item in timeline['interruptions']:
            u, a = by_id[item['user_id']], by_id[item['assistant_id']]
            check(u['speaker'] != 'assistant' and a['speaker'] == 'assistant', 'Invalid interruption roles')
            check(a['start_at_ms'] <= u['start_at_ms'] < a['end_at_ms'], 'Interruption has no actual assistant overlap')
            detected, command, stop, fade = (item[k] for k in ('detected_at_ms', 'stop_command_at_ms', 'stop_at_ms', 'fade_start_at_ms'))
            check(all(ms(t) for t in (detected, command, stop, fade)), 'Invalid interruption timestamps')
            check(u['start_at_ms'] <= detected <= command <= fade < stop == a['end_at_ms'], 'Invalid detection/command/fade/stop order')
        runs = {r['event_id']: r for r in timeline['tool_runs']}
        check(len(runs) == len(timeline['tool_runs']), 'Duplicate tool_runs event_id')
        for eid, run in runs.items():
            if not interval(run, eid, duration):
                continue
            group = event_groups.get(eid, [])
            requests = [e for e in group if 'query' in e]
            results = [e for e in group if 'results' in e or 'result' in e]
            check(len(requests) == 1 and len(results) == 1, f'{eid}: tool run requires matching request and result')
            if requests and results:
                check(run['start_at_ms'] == requests[0]['time_at_ms'] and run['end_at_ms'] == results[0]['time_at_ms'], f'{eid}: run and Events differ')
            for dependency in run.get('depends_on', []):
                check(dependency in runs, f'{eid}: unknown dependency {dependency}')
                if dependency in runs:
                    check(runs[dependency]['end_at_ms'] <= run['start_at_ms'], f'{eid}: dependency completes after call starts')
            if 'decision_end_at_ms' in run:
                check(ms(run['decision_end_at_ms']) and run['decision_end_at_ms'] <= run['start_at_ms'], f'{eid}: call starts before decision completes')
    except (KeyError, TypeError, ValueError) as exc:
        errors.append(f'Malformed contract: {exc}')
    return errors


def main():
    if len(sys.argv) != 3:
        print('Usage: validate_case.py case.json timeline.json', file=sys.stderr)
        return 2
    try:
        case, timeline = [json.loads(Path(p).read_text(encoding='utf-8')) for p in sys.argv[1:]]
    except (OSError, ValueError) as exc:
        print(f'Cannot load JSON: {exc}', file=sys.stderr)
        return 2
    errors = validate(case, timeline)
    for error in errors:
        print('ERROR:', error)
    if errors:
        return 1
    print('PASS: Case schema, timeline, response gaps, interruption timing and tool dependencies.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
