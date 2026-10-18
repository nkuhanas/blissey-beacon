# Synthetic room feeds and archive-based reset

Status: Approved explicitly by the user on 2026-10-18.

Affected sections: §18 persistence, §19 connected dashboard, §23 APIs, §26 validation, §31 decisions.

Previously, synthetic scenarios never produced health reports, reset resolved active alerts without hiding history, and resolved cards remained selected indefinitely.

Revised: run a bounded repeating synthetic healthy sample for every configured demo room except 101 and any room with registered hardware credentials. Keep synthetic samples separate from authenticated Pi health/events. Persist the latest sample and loop index; do not generate endless healthy incidents or trigger communications. Retain explicit scenario controls, with offline scenarios overriding synthetic monitoring until reset or a healthy scenario.

An authenticated, facility-authorized room reset archives all existing room events and incidents from normal dashboard/history reads, atomically and idempotently. Preserve original payloads, deduplication identity, communication and audit records. New incoming events after reset remain visible; room 101 never receives synthetic monitoring. Resetting a simulated room restores its healthy baseline. Archival is not clinical resolution and does not authorize calls/texts.

A resolved card returns to normal monitoring after sixty seconds, while history retains the incident until reset. Explicit history selection remains possible.

Rationale: provide a populated connected demonstration while preserving live Pi boundaries and referential/audit integrity. No new model, event-schema, hardware or provider capability is claimed.

ADR-039 records this amendment. Production deployment and physical Pi behavior require separate verification.
