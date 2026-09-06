# Peer protocol 1

`src/protocol.ts` implements bounded serialization/parsing. `src/peer-match.ts` establishes the WebRTC channels and handshake; `src/online-worker.ts` schedules `src/network-session.ts`, which integrates rollback, repairs and hash recovery.

Gameplay uses an unordered DataChannel with `maxRetransmits: 0`. Each binary message is 21–28 bytes:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u16 LE | magic `0x4344` |
| 2 | u8 | protocol 1 |
| 3 | u8 | sender slot 0/1 |
| 4 | u32 LE | session epoch |
| 8 | u32 LE | first input tick |
| 12 | i32 LE | inclusive input-complete acknowledgement |
| 16 | u8 | frame count, 1–8 |
| 17–19 | bytes | zero reserved bytes |
| 20 onward | u8 each | consecutive button masks, 0–31 |

Receivers validate epoch, sender ownership, size, reserved bytes, masks and tick window before passing records to the rollback engine. The rollback engine rejects conflicting submissions while allowing identical duplicates. Latest-eight packets can overlap. Reliable repair supplies older missing inputs.

The ordered reliable control channel carries validated JSON: content hello (match ID, epoch, slot, identities, delay), ready/start exchange, ping/pong probes, missing ranges, up to 120 repaired frames, agreed hashes, one bounded 8384-byte recovery snapshot, recovery acknowledgement, resume state and disconnect reason. Control messages are limited to 40,000 characters and their typed payload bounds are checked before use. The transport and session enforce sequencing, acknowledgement ownership and recovery authority. Tick-zero scheduling uses measured RTT and a bounded start delay; timing never enters gameplay. Gameplay sends are dropped at 4096 buffered bytes. Reliable queues are bounded to 256 messages/256 KiB. A ten-second input stall ends the match even if control pings still respond.

Player 0 refreshes ICE server credentials and initiates an ICE restart every four minutes. Each explicit restart also refreshes credentials; player 1 refreshes before answering an in-match offer. The lobby fetch has an eight-second timeout and verifies the match identity before using the response. Credentials are applied with `setConfiguration`; worker state, epoch and input history remain in place. After a signaling reconnect the client resends a pending offer, or starts a fresh ICE negotiation. Browser tests advance the renewal deadline to exercise this path over real TURN channels; an extended wall-clock match remains a public acceptance check.
