  ;; Find a pad supporting a hull at this position. A zero result is never a pad.
  (func $pad_at (param $x i32) (param $y i32) (result i32)
    (local $pad i32)
    (local.set $pad (i32.const 32784))
    (loop $search_pad
      (if (i32.and
        (i32.le_s (call $abs (i32.sub (i32.add (local.get $y) (i32.const 1048576)) (i32.load offset=4 (local.get $pad)))) (i32.const 64))
        (i32.le_s (i32.add (call $abs (i32.sub (local.get $x) (i32.load (local.get $pad)))) (i32.const 1048576)) (i32.load offset=8 (local.get $pad))))
        (then (return (local.get $pad))))
      (local.set $pad (i32.add (local.get $pad) (i32.const 12)))
      (br_if $search_pad (i32.lt_u (local.get $pad) (i32.const @padsEnd@))))
    (i32.const 0))
  (func $spawn (param $p i32)
    (local $pad i32) (local $candidate i32) (local $other i32)
    (local $distance i64) (local $nearest i64) (local $best i64) (local $dx i64) (local $dy i64)
    (if (i32.eqz (i32.load (i32.const 4096))) (then
      ;; A seed-dependent permutation assigns distinct starting pads.
      (local.set $pad (i32.add (i32.const 32784) (i32.mul (i32.rem_u
        (i32.add (i32.load (i32.const 4112)) (i32.div_u (i32.sub (local.get $p) (i32.const 4160)) (i32.const 64)))
        (i32.const @padCount@)) (i32.const 12)))))
    (else
      ;; Maximize the distance to the nearest living opponent; ties use pad order.
      (local.set $candidate (i32.const 32784)) (local.set $best (i64.const -1))
      (loop $pads
        (local.set $nearest (i64.const 9223372036854775807))
        (local.set $other (i32.const 4160))
        (loop $opponents
          (if (i32.and (i32.ne (local.get $other) (local.get $p)) (i32.gt_s (i32.load offset=28 (local.get $other)) (i32.const 0))) (then
            (local.set $dx (i64.extend_i32_s (i32.sub (i32.load (local.get $candidate)) (i32.load (local.get $other)))))
            (local.set $dy (i64.extend_i32_s (i32.sub (i32.sub (i32.load offset=4 (local.get $candidate)) (i32.const 1048577)) (i32.load offset=4 (local.get $other)))))
            (local.set $distance (i64.add (i64.mul (local.get $dx) (local.get $dx)) (i64.mul (local.get $dy) (local.get $dy))))
            (if (i64.lt_s (local.get $distance) (local.get $nearest)) (then (local.set $nearest (local.get $distance))))))
          (local.set $other (i32.add (local.get $other) (i32.const 64)))
          (br_if $opponents (i32.lt_u (local.get $other) (call $ship (call $players)))))
        (if (i64.gt_s (local.get $nearest) (local.get $best)) (then
          (local.set $best (local.get $nearest)) (local.set $pad (local.get $candidate))))
        (local.set $candidate (i32.add (local.get $candidate) (i32.const 12)))
        (br_if $pads (i32.lt_u (local.get $candidate) (i32.const @padsEnd@))))))
    (i32.store (local.get $p) (i32.load (local.get $pad)))
    (i32.store offset=4 (local.get $p) (i32.sub (i32.load offset=4 (local.get $pad)) (i32.const 1048577)))
    (i32.store offset=8 (local.get $p) (i32.const 0)) (i32.store offset=12 (local.get $p) (i32.const 0))
    (i32.store offset=16 (local.get $p) (i32.const 0)) (i32.store offset=20 (local.get $p) (i32.const 0))
    (i32.store offset=24 (local.get $p) (i32.const @fuelCapacity@)) (i32.store offset=28 (local.get $p) (i32.const @hull@))
    (memory.fill (call $aux (local.get $p)) (i32.const 0) (i32.const 8))
    (memory.fill (i32.add (local.get $p) (i32.const 52)) (i32.const 0) (i32.const 12))
    (i32.store offset=36 (local.get $p) (i32.const 0))
    (i32.store offset=48 (local.get $p) (i32.const @spawnProtection@))
    (i32.store offset=32 (local.get $p) (i32.const 1)) (i32.store offset=40 (local.get $p) (i32.const 0))
    (if (i32.eqz (i32.load (i32.const 4104))) (then
      (i32.store (local.get $p) (i32.mul (i32.sub (i32.div_u (i32.sub (local.get $p) (i32.const 4160)) (i32.const 32)) (i32.const 1)) (i32.const 19660800)))
      (i32.store offset=4 (local.get $p) (i32.const 0)) (i32.store offset=32 (local.get $p) (i32.const 0)))))
  (func $pre_tick (param $p i32)
    (if (i32.gt_s (i32.load offset=36 (local.get $p)) (i32.const 0)) (then (i32.store offset=36 (local.get $p) (i32.sub (i32.load offset=36 (local.get $p)) (i32.const 1)))))
    (if (i32.gt_s (i32.load offset=48 (local.get $p)) (i32.const 0)) (then (i32.store offset=48 (local.get $p) (i32.sub (i32.load offset=48 (local.get $p)) (i32.const 1)))))
    (if (i32.gt_s (i32.load offset=40 (local.get $p)) (i32.const 0)) (then
      (i32.store offset=40 (local.get $p) (i32.sub (i32.load offset=40 (local.get $p)) (i32.const 1)))
      (if (i32.eqz (i32.load offset=40 (local.get $p))) (then (call $spawn (local.get $p)) (call $ship_event (i32.const 7) (local.get $p) (i32.const 0)))))))
  (func $move (param $p i32) (param $dx i32) (param $dy i32)
    (local $x i32) (local $y i32) (local $t i32) (local $pad i32) (local $angle i32)
    (local.set $x (i32.load (local.get $p))) (local.set $y (i32.load offset=4 (local.get $p)))
    (local.set $t (call $terrain_toi (local.get $x) (local.get $y) (local.get $dx) (local.get $dy) (i32.const 1048576)))
    (if (i32.le_s (local.get $t) (i32.const 65536)) (then
      (local.set $x (i32.add (local.get $x) (call $mul (local.get $dx) (local.get $t))))
      (local.set $y (i32.add (local.get $y) (call $mul (local.get $dy) (local.get $t))))
      (local.set $pad (call $pad_at (local.get $x) (local.get $y)))
      (local.set $angle (i32.load offset=16 (local.get $p)))
      (local.set $angle (call $min (local.get $angle) (i32.sub (i32.const 4096) (local.get $angle))))
      (if (i32.and (i32.ne (local.get $pad) (i32.const 0)) (i32.and
        (i32.and (i32.gt_s (local.get $dy) (i32.const 0))
          (i32.le_s (i32.load offset=4 (local.get $p)) (i32.sub (i32.load offset=4 (local.get $pad)) (i32.const 1048576))))
        (i32.and
          (i32.and (i32.le_s (call $abs (i32.sub (i32.add (local.get $y) (i32.const 1048576)) (i32.load offset=4 (local.get $pad)))) (i32.const 64))
            (i32.le_s (i32.add (call $abs (i32.sub (local.get $x) (i32.load (local.get $pad)))) (i32.const 1048576)) (i32.load offset=8 (local.get $pad))))
          (i32.and
            (i32.and (i32.le_s (call $abs (i32.load offset=8 (local.get $p))) (i32.const @landingMaxVx@))
              (i32.le_s (i32.load offset=12 (local.get $p)) (i32.const @landingMaxVy@)))
            (i32.and (i32.le_s (local.get $angle) (i32.const @landingMaxAngle@))
              (i32.le_s (call $abs (i32.load offset=20 (local.get $p))) (i32.const @landingMaxSpin@)))))))
        (then
          (call $ship_event (i32.const 6) (local.get $p) (i32.const 0))
          (i32.store offset=32 (local.get $p) (i32.const 1))
          (i32.store offset=16 (local.get $p) (i32.const 0))
          (local.set $y (i32.sub (i32.load offset=4 (local.get $pad)) (i32.const 1048577))))
        (else
          (if (i32.load8_u (call $aux (local.get $p))) (then
            (call $shield_bounce (local.get $p) (local.get $dx) (local.get $dy) (local.get $t) (local.get $x) (local.get $y))
            (return)))
          (i32.store (i32.add (i32.const 40016) (i32.mul (i32.div_u (i32.sub (local.get $p) (i32.const 4160)) (i32.const 64)) (i32.const 4))) (i32.const 1))))
      (i32.store offset=8 (local.get $p) (i32.const 0)) (i32.store offset=12 (local.get $p) (i32.const 0))
      (i32.store offset=20 (local.get $p) (i32.const 0)))
    (else (local.set $x (i32.add (local.get $x) (local.get $dx))) (local.set $y (i32.add (local.get $y) (local.get $dy)))))
    (i32.store (local.get $p) (local.get $x)) (i32.store offset=4 (local.get $p) (local.get $y)))

  ;; Reflect the incident velocity about the face/corner normal at the swept contact.
  (func $shield_bounce (param $p i32) (param $dx i32) (param $dy i32) (param $t i32) (param $x i32) (param $y i32)
    (local $r i32) (local $nx i32) (local $ny i32) (local $dot i64) (local $scale i32)
    (local.set $r (i32.const 32832))
    (block $found (loop $solids
      (br_if $found (i32.eq (call $rect_toi (i32.load (local.get $p)) (i32.load offset=4 (local.get $p)) (local.get $dx) (local.get $dy) (local.get $r) (i32.const 1048576)) (local.get $t)))
      (local.set $r (i32.add (local.get $r) (i32.const 16)))
      (br_if $solids (i32.lt_u (local.get $r) (i32.add (i32.const 32832) (i32.mul (call $solid_count) (i32.const 16)))))
      (return)))
    (local.set $nx (i32.sub (local.get $x) (call $max (i32.load (local.get $r)) (call $min (local.get $x) (i32.load offset=8 (local.get $r))))))
    (local.set $ny (i32.sub (local.get $y) (call $max (i32.load offset=4 (local.get $r)) (call $min (local.get $y) (i32.load offset=12 (local.get $r))))))
    (if (i32.eqz (i32.or (local.get $nx) (local.get $ny))) (then
      (local.set $nx (i32.sub (i32.const 0) (local.get $dx))) (local.set $ny (i32.sub (i32.const 0) (local.get $dy)))
      (if (i32.eqz (i32.or (local.get $nx) (local.get $ny))) (then (local.set $ny (i32.const -65536))))))
    (local.set $dot (i64.add (i64.mul (i64.extend_i32_s (local.get $nx)) (i64.extend_i32_s (i32.load offset=8 (local.get $p))))
      (i64.mul (i64.extend_i32_s (local.get $ny)) (i64.extend_i32_s (i32.load offset=12 (local.get $p))))))
    (if (i64.lt_s (local.get $dot) (i64.const 0)) (then
      (local.set $scale (i32.wrap_i64 (i64.div_s (i64.mul (local.get $dot) (i64.const 114688)) (call $dist2 (local.get $nx) (local.get $ny)))))
      (i32.store offset=8 (local.get $p) (call $clamp (i32.sub (i32.load offset=8 (local.get $p)) (call $mul (local.get $nx) (local.get $scale))) (i32.const @maxSpeed@)))
      (i32.store offset=12 (local.get $p) (call $clamp (i32.sub (i32.load offset=12 (local.get $p)) (call $mul (local.get $ny) (local.get $scale))) (i32.const @maxSpeed@)))))
    ;; Separate from the surface by a small deterministic margin.
    (local.set $scale (call $max (call $abs (local.get $nx)) (call $abs (local.get $ny))))
    (i32.store (local.get $p) (i32.add (local.get $x) (i32.div_s (i32.mul (local.get $nx) (i32.const 128)) (local.get $scale))))
    (i32.store offset=4 (local.get $p) (i32.add (local.get $y) (i32.div_s (i32.mul (local.get $ny) (i32.const 128)) (local.get $scale))))
    (i32.store8 offset=1 (call $aux (local.get $p)) (i32.const 12)))
