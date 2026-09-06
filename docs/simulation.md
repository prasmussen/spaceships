# Simulation ABI 1 (development)

Gameplay resides in handwritten WAT fragments. `build-sim.mjs` concatenates fragments, inserts static integer data, substitutes versioned tuning constants, and emits validation comparisons. It assembles and validates with pinned WABT. `public/build.json` records SHA-256 identities for the exact WASM, map bytes, and configuration bytes. All peers must eventually use these exact identities; transport is not implemented yet.

## Memory

One fixed 256 KiB memory; no imports and no growth.

| Address | Contents |
| --- | --- |
| 0 | 32-byte ABI metadata: magic CDUL, version, state address/size, input address, snapshot staging address, frame address, player count |
| 1024 | Frozen tuning configuration, signed little-endian i32 fields in build-script order |
| 2048 | Up to 120 consecutive paired input records, one byte per player |
| 4096 | 8384-byte canonical authoritative state |
| 65536 | 8384-byte snapshot staging buffer |
| 81920 | State, event count and contiguous event records |
| 16384 | 4096 checked-in Q16.16 sine entries; cosine uses a quarter-turn offset |
| 32768 | Map header, two pads, rectangular solid polygons |
| 33792 | 16×10 uniform grid, each cell a 32-bit solid-ID mask |
| 40000 | Per-tick pending damage/crash flags and old ship positions (scratch) |
| 131072 | Event count and up to 512 32-byte event records (scratch) |

`init(1024, map, seed)` accepts map 0 for the open flight lab or 32768 for the cave. It validates frozen config/map bytes before changing state. Seed is reserved: gameplay has no randomness. Both ships start full; cave ships start grounded at their own pads.

`step(2048, count)` consumes 0–120 records. Input bits: thrust 1, left 2, right 4; fire 8. Inputs stay constant over both substeps. A step returns 1 on success, 0 on invalid ABI arguments or tick overflow. All simulation exports have fixed destinations; hosts cannot make them overwrite immutable data through arbitrary pointers.

`save_state(65536)` and `write_frame(81920)` return the number of bytes written, or 0 for invalid destinations. `load_state(65536, 8384)` validates first, then restores atomically. It checks tick bounds, mode identity, header/reserved bytes, position/velocity/angle/fuel/hull bounds, grounded/respawn consistency, and own-pad position for grounded ships. State hashes use 64-bit FNV-1a over every state byte. Hashes are diagnostics, not cryptographic authentication.

## State layout

All fields are little-endian i32. Header: tick at 0, winner at 4 (-1/0/1), cave mode at 8, projectile sequence at 12; bytes 16–63 are zero. Ships begin at 64 and 128 with a 64-byte stride.

| Ship offset | Field |
| --- | --- |
| 0, 4 | x, y |
| 8, 12 | x/y velocity per tick |
| 16, 20 | wrapped orientation, angular velocity per tick |
| 24, 28 | fuel, hull |
| 32 | grounded flag |
| 36 | weapon cooldown ticks |
| 40 | respawn ticks remaining |
| 44 | score; crashes deduct one |
| 48 | spawn protection ticks |
| 52–63 | reserved, zero |

Projectile slots follow the ships at state offset 192: 256 slots × 32 bytes. Fields are x, y, vx, vy, lifetime, owner, unique sequence ID, and metadata (zero for shots). Debris uses marker bit 28, shape bits 0–4, orientation bits 5–16, and a first-contact flag in bit 17. Inactive slots are entirely zero. Allocation selects the lowest free slot; sequence IDs never wrap. Snapshots validate IDs, uniqueness, lifetime, ownership, velocity and remaining-travel overflow bounds.

Frame output starts with the complete state, then one i32 event count followed by 32-byte event records: tick, entity, index, type, x, y, player, data. Event types: shot 1, ship hit 2, terrain impact 3, projectile death 4, crash 5, landing 6, respawn 7, winner 8. Snapshots exclude all presentation events. No published network compatibility is promised for this development ABI.

## Integer rules and bounds

Spatial quantities are signed Q16.16. Multiplication widens to i64 and divides by 65536, truncating toward zero. Division of a velocity into a substep also truncates toward zero. Angles wrap with `& 4095`. Velocity/position saturate at versioned bounds in the open laboratory. Cave movement is bounded by closed solid walls.

Semi-implicit Euler updates velocity before position and spin before angle. Two substeps run per 60 Hz tick. No passive damping is applied. The camera is purely cosmetic and uses floating-point damping on the main thread.

Cave geometry uses axis-aligned rectangular solid polygons quantized to integer world units. Grid queries OR candidate bitsets across the swept circle's bounding box, then visit solids by ascending ID. Swept collision checks offset faces and rounded corners. TOI is an integer fraction in [0, 65536]; 65537 denotes no hit. Face division truncates, and corner searches return the first intersecting quantized time. Contact positions can differ from the mathematical continuous surface by at most a substep's displacement divided by 65536 plus fixed-point rounding; landing permits 64 Q16 integer units of surface error (less than 0.001 world unit). Circle corner bounding checks occur before multiplying the closest-point numerator, preserving i64 bounds at the capped displacement.

Ship radius is 16 world units. Landing requires downward travel from above, the full circle footprint in the player's own pad, and all four tuning thresholds. Grounding zeros velocity, spin and orientation. Refueling runs per substep only while grounded; thrust launches and consumes fuel. Other terrain contact stops movement and records a pending crash. All damage and crashes are resolved after both physics substeps, preserving projectile trades. A same-tick terrain crash takes precedence over projectile death for cause/scoring, deducts one point, and starts a 120-tick respawn timer. Ship-to-ship contact sweeps both radius-16 hulls using relative motion in each substep. Both ships stop at contact and crash, each losing one point and emitting an explosion, even during spawn protection. Dead ships do not collide.

Projectiles inherit ship velocity plus the configured muzzle speed, run at constant velocity, and sweep against terrain and moving enemy ship circles. Terrain wins equal contact times. Three hits kill; all pending hits are collected before deaths. Firing or leaving the pad ends spawn protection; otherwise it expires after 90 ticks. Winning requires at least five points and a lead; gameplay freezes on a winner.

Ship explosions allocate up to 16 debris pieces in the same bounded pool. Debris is canonical gameplay state: integer motion, wall bounces, moving-ship sweeps, lifetime, and contacts participate in snapshots and rollback. Pieces inherit ship velocity, accelerate under gravity, remain opaque for 180 ticks, then fade for six ticks. A piece rebounds from the opposing living ship without hull damage; its first contact reduces ship velocity by 2%, with at most one reduction per ship per tick. Debris stays visible when cosmetic particles are disabled. Pool exhaustion limits new debris rather than allocating more memory.

## Evidence and limits

`npm test` covers flight arithmetic and snapshots; landing tests exercise thresholds below/at/above limits, own/opponent pads, respawn timing, launch/refuel and high-speed pillar impact. Diagnostic-only builds export collision helpers so tests can compare 20,000 swept circles with an independent analytic oracle and 4,000 uniform-grid queries with full solid scans. Those helper exports are absent from the production artifact.

The browser script checks actual WebGPU shader validation, keyboard flight, restart, mode switching and launching from the pad. Its replay matrix runs independently of WebGPU support, comparing engine hashes to Node with different presentation-read cadences. These automated checks do not establish subjective flight feel or internet multiplayer acceptance.
