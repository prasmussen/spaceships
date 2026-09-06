# Simulation ABI 2 (development)

Gameplay resides in handwritten WAT fragments. `build-sim.mjs` concatenates fragments, inserts static integer data, substitutes versioned tuning constants, and emits validation comparisons. It assembles and validates with pinned WABT. `public/build.json` records SHA-256 identities for the exact WASM, map bytes, and configuration bytes. Peers verify these identities before starting a match.

## Memory

One fixed 256 KiB memory; no imports and no growth.

| Address | Contents |
| --- | --- |
| 0 | 32-byte ABI metadata: magic CDUL, version, state address/size, input address, snapshot staging address, frame address, maximum player count (4) |
| 1024 | Frozen tuning configuration, signed little-endian i32 fields in build-script order |
| 2048 | Up to 120 consecutive input vectors with a stride equal to the active player count, one byte per player |
| 4096 | 8512-byte canonical authoritative state |
| 65536 | 8512-byte snapshot staging buffer |
| 81920 | State, event count and contiguous event records |
| 16384 | 4096 checked-in Q16.16 sine entries; cosine uses a quarter-turn offset |
| 32768 | Map header, four shared pads, rectangular solid polygons |
| 33792 | 16×10 uniform grid, each cell a 32-bit solid-ID mask |
| 40000 | Per-tick pending damage/crash flags and old ship positions (scratch) |
| 131072 | Event count and up to 512 32-byte event records (scratch) |

`init(1024, map, seed, players)` accepts map 0 for unbounded arithmetic tests, 32768 for the cave, or 32769 for the Flight lab arena. It accepts 2–4 players and validates frozen config/map bytes before changing state. The seed selects a deterministic rotation of the four starting pads, assigning distinct pads to the players. Local games generate a fresh seed; online peers share the match seed. Mapped games start full and grounded; map 0 starts in free flight. After play begins, respawns maximize distance to the nearest living opponent; equal distances use map pad order.

`step(2048, count)` consumes 0–120 records. Input bits: thrust 1, left 2, right 4; fire 8; boost 16. Inputs stay constant over both substeps. A step returns 1 on success, 0 on invalid ABI arguments or tick overflow. All simulation exports have fixed destinations; hosts cannot make them overwrite immutable data through arbitrary pointers.

`save_state(65536)` and `write_frame(81920)` return the number of bytes written, or 0 for invalid destinations. `load_state(65536, 8512)` validates first, then restores atomically. It checks tick bounds, mode/seed/player-count identity, inactive ship slots, header/reserved bytes, position/velocity/angle/fuel/hull bounds, grounded/respawn consistency, and shared-pad position for grounded ships. State hashes use 64-bit FNV-1a over every state byte. Hashes are diagnostics, not cryptographic authentication.

## State layout

All fields are little-endian i32. Header: tick at 0, winner at 4 (-1 or an active player slot), cave mode at 8, projectile sequence at 12, match seed at 16, active player count at 20; bytes 24–63 are zero. Four ship slots begin at offset 64 with a 64-byte stride; inactive slots are entirely zero.

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
| 52 | boost ticks remaining |
| 56 | boost cooldown ticks remaining |
| 60 | previous boost button (0 or 1) |

Projectile slots follow the ships at state offset 320: 256 slots × 32 bytes. Fields are x, y, vx, vy, lifetime, owner, unique sequence ID, and metadata (zero for shots). Debris uses marker bit 28, shape bits 0–4, orientation bits 5–16, and a first-contact flag in bit 17. Inactive slots are entirely zero. Allocation selects the lowest free slot; sequence IDs never wrap. Snapshots validate IDs, uniqueness, lifetime, ownership, velocity and remaining-travel overflow bounds.

Frame output starts with the complete state, then one i32 event count followed by 32-byte event records: tick, entity, index, type, x, y, player, data. Event types: shot 1, ship hit 2, terrain impact 3, projectile death 4, crash 5, landing 6, respawn 7, winner 8. Snapshots exclude all presentation events. No published network compatibility is promised for this development ABI.

## Integer rules and bounds

Spatial quantities are signed Q16.16. Multiplication widens to i64 and divides by 65536, truncating toward zero. Division of a velocity into a substep also truncates toward zero. Angles wrap with `& 4095`. Velocity/position saturate at versioned bounds in the open laboratory. Cave movement is bounded by closed solid walls.

Semi-implicit Euler updates velocity before position and spin before angle. Two substeps run per 60 Hz tick. Neutral steering (neither or both rotation keys) brakes angular velocity by eight units per substep, stopping maximum spin within five ticks (about 83 ms) without fuel use. Maximum rotation speed is 72 angle units per tick (about 380 degrees per second). When thrust is inactive, each velocity component loses 1/512 of its value per substep before gravity is applied (about 21% horizontal speed loss per second). Active thrust bypasses this drag; an empty tank does not. Debris retains its existing momentum and collision rules. The camera is purely cosmetic and uses floating-point damping on the main thread.

Cave geometry uses axis-aligned rectangular solid polygons quantized to integer world units. Grid queries OR candidate bitsets across the swept circle's bounding box, then visit solids by ascending ID. Swept collision checks offset faces and rounded corners. TOI is an integer fraction in [0, 65536]; 65537 denotes no hit. Face division truncates, and corner searches return the first intersecting quantized time. Contact positions can differ from the mathematical continuous surface by at most a substep's displacement divided by 65536 plus fixed-point rounding; landing permits 64 Q16 integer units of surface error (less than 0.001 world unit). Circle corner bounding checks occur before multiplying the closest-point numerator, preserving i64 bounds at the capped displacement.

Both maps span 6400 × 4000 world units, four times the original area, with a 16 × 10 collision grid of 400-unit cells. The cave has sparse platforms and broad flight corridors. The arena uses the cave perimeter and four pad platforms (the first eight solids), with all central obstacles omitted from rendering and every collision query.

Ship radius is 16 world units. Landing requires downward travel from above, the full circle footprint in any shared pad, and all four tuning thresholds. Grounding zeros velocity, spin and orientation. Refueling runs per substep only while grounded; thrust launches and consumes fuel. Other terrain contact stops movement and records a pending crash. All damage and crashes are resolved after both physics substeps, preserving projectile trades. A same-tick terrain crash takes precedence over projectile death for cause/scoring, deducts one point, and starts a 120-tick respawn timer. Ship-to-ship contact sweeps both radius-16 hulls using relative motion in each substep. Both ships stop at contact and crash, each losing one point and emitting an explosion, even during spawn protection. Dead ships do not collide.

Projectiles inherit ship velocity plus the configured muzzle speed, run at constant velocity, and sweep against terrain and moving enemy ship circles. Each shot selects its earliest opponent contact, with lowest-slot ties; terrain wins equal contact times. Three hits kill; all pending hits are collected before deaths. The shot that reaches lethal pending damage earns the kill, in substep/projectile-slot order. Simultaneous trades retain credit even when the shooter also dies. Firing or leaving the pad ends spawn protection; otherwise it expires after 90 ticks. Winning requires at least five points and a unique lead over every opponent; gameplay freezes on a winner.

Active, fueled thrusters push nearby opponents away along the exhaust direction. The cone starts behind the nozzle, extends 64 world units to the near edge of a target hull, and fades both with distance and toward its sides. Solid terrain blocks the force and dead ships are excluded. Parked ships slide under exhaust pressure, including a minimum sideways deflection from centered jets. Pad impulses are amplified twelvefold and capped at 0.75 world units per tick, accumulating sliding velocity up to 1.5 world units per tick. Pad friction retains 31/32 of that velocity each substep, so movement continues briefly after a burst while the ship remains grounded and refuels. The pad absorbs downward pressure. Upward pressure can lift a ship, and sliding beyond its pad releases grounding. All emitters are evaluated before each flight substep, with fixed-point impulses capped by the normal speed limit. Exhaust adds no hull damage.

Ship explosions allocate up to 16 debris pieces in the same bounded pool. Debris is canonical gameplay state: integer motion, wall bounces, moving-ship sweeps, lifetime, and contacts participate in snapshots and rollback. Pieces inherit ship velocity, accelerate under gravity, remain opaque for 180 ticks, then fade for six ticks. A piece rebounds from the earliest opposing living ship without hull damage; its first contact reduces ship velocity by 2%, with at most one reduction per ship per tick. Debris stays visible when cosmetic particles are disabled. Pool exhaustion limits new debris rather than allocating more memory.

## Evidence and limits

`npm test` covers flight arithmetic and snapshots; landing tests exercise thresholds below/at/above limits, all shared pads, respawn timing, launch/refuel and high-speed pillar impact. Diagnostic-only builds export collision helpers so tests can compare 20,000 swept circles with an independent analytic oracle and 4,000 uniform-grid queries with full solid scans. Those helper exports are absent from the production artifact.

The browser script checks actual WebGPU shader validation, keyboard flight, removal of the restart shortcut, mode switching and launching from the pad. Its replay matrix runs independently of WebGPU support, comparing engine hashes to Node with different presentation-read cadences. These automated checks do not establish subjective flight feel or internet multiplayer acceptance.

Boost is triggered by a fresh press of bit 16 (Left Shift by default). It starts a self-contained 18-tick burst at four times normal acceleration and exhaust force, costs 120 fuel upfront plus normal thrust fuel, and recharges 300 ticks (5 seconds) from activation. More than 120 fuel is required to start; an empty tank stops thrust. Holding the key does not repeat the boost. It launches from pads and retains normal collision, speed, exhaust cone, terrain occlusion and pad impulse limits. Timers and the input latch are validated snapshot state; respawn resets them.
