# Peer protocol 2

`src/protocol.ts` implements bounded serialization/parsing. `src/peer-match.ts` establishes the WebRTC channels and handshake; `src/online-worker.ts` schedules `src/network-session.ts`, which integrates rollback, repairs and hash recovery.

Each participant connects to every other participant (one link per opponent). The lower slot offers each link. All links verify match identity, player count, and connection-bound sender slot. Slot 0 waits for every participant to report a ready mesh, then schedules a shared start using RTT measurements.

Gameplay uses an unordered DataChannel with `maxRetransmits: 0`. Each binary message is 21–28 bytes:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u16 LE | magic `0x5353` |
| 2 | u8 | protocol 2 |
| 3 | u8 | sender slot 0–3 |
| 4 | u32 LE | session epoch |
| 8 | u32 LE | first input tick |
| 12 | i32 LE | inclusive input-complete acknowledgement |
| 16 | u8 | frame count, 1–8 |
| 17–19 | bytes | zero reserved bytes |
| 20 onward | u8 each | consecutive button masks, 0–63 (thrust 1, left 2, right 4, fire 8, boost 16, shield 32) |

Receivers validate epoch, sender ownership, size, reserved bytes, masks and tick window before passing records to the rollback engine. The rollback engine rejects conflicting submissions while allowing identical duplicates. Latest-eight packets can overlap. Reliable repair supplies older missing inputs.

The ordered reliable control channel carries validated JSON: content hello (match ID, epoch, slot, player count, identities, delay), per-link ready and full-mesh ready/start exchange, ping/pong probes, missing ranges, up to 120 repaired frames, agreed hashes with a recovery revision, one bounded 8512-byte recovery snapshot, all-peer recovery acknowledgements and coordinator completion, resume state and disconnect reason. Control messages are limited to 40,000 characters and their typed payload bounds are checked before use. The transport and session enforce sequencing, acknowledgement ownership and recovery authority. Tick-zero scheduling uses measured RTT and a bounded start delay; timing never enters gameplay. Gameplay sends are dropped at 4096 buffered bytes. Reliable queues are bounded to 256 messages/256 KiB. A ten-second input stall ends the match even if control pings still respond.

For each link, the lower slot refreshes ICE credentials and initiates a restart every four minutes. Each explicit restart refreshes credentials; the higher slot refreshes before answering an in-match offer. The lobby fetch has an eight-second timeout and verifies the match identity before using the response. Credentials are applied with `setConfiguration`; worker state, epoch and input history remain in place. After a signaling reconnect the client resends a pending offer, or starts a fresh ICE negotiation. Browser tests advance the renewal deadline to exercise this path over real TURN channels; an extended wall-clock match remains a public acceptance check.

An agreed tick requires every input column and every remote acknowledgement. On a first mismatch, slot 0 sends its agreed snapshot to all participants and waits for matching acknowledgements from everyone before broadcasting recovery completion. Revision-tagged hashes exclude stale pre-recovery reports. A repeated mismatch aborts the match. Any player leaving or remaining disconnected beyond recovery bounds ends the whole match.
