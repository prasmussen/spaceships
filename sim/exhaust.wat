  ;; Exhaust pushes hulls in a short cone behind a firing thruster.
  ;; Evaluate both emitters before flight so player order cannot change the force.
  (func $exhaust_force (param $p i32) (param $target i32) (param $buttons i32)
    (local $dx i32) (local $dy i32) (local $sin i32) (local $cos i32)
    (local $lateral i32) (local $distance i32) (local $side i32) (local $width i32) (local $force i32) (local $push i32)
    (local.set $buttons (call $thrust_buttons (local.get $p) (local.get $buttons)))
    (if (i32.or (i32.eqz (i32.and (local.get $buttons) (i32.const 1)))
      (i32.or (i32.eqz (i32.load offset=24 (local.get $p)))
        (i32.or (i32.eqz (i32.load offset=28 (local.get $p)))
          (i32.eqz (i32.load offset=28 (local.get $target)))))) (then (return)))
    (if (i32.or (i32.load (i32.const 40008)) (i32.load (i32.const 40012))) (then (return)))
    (local.set $dx (i32.sub (i32.load (local.get $target)) (i32.load (local.get $p))))
    (local.set $dy (i32.sub (i32.load offset=4 (local.get $target)) (i32.load offset=4 (local.get $p))))
    (if (i32.or (i32.gt_u (call $abs (local.get $dx)) (i32.const 6291456))
      (i32.gt_u (call $abs (local.get $dy)) (i32.const 6291456))) (then (return)))
    (local.set $sin (call $sin (i32.load offset=16 (local.get $p))))
    (local.set $cos (call $sin (i32.add (i32.load offset=16 (local.get $p)) (i32.const 1024))))
    (local.set $distance (i32.sub (call $mul (local.get $dy) (local.get $cos)) (call $mul (local.get $dx) (local.get $sin))))
    (if (i32.le_s (local.get $distance) (i32.const 524288)) (then (return)))
    ;; Distance from nozzle to the near edge of the target's radius-16 hull.
    (local.set $distance (call $max (i32.const 0) (i32.sub (local.get $distance) (i32.const 1572864))))
    (if (i32.ge_s (local.get $distance) (i32.const 4194304)) (then (return)))
    (local.set $lateral (i32.add (call $mul (local.get $dx) (local.get $cos)) (call $mul (local.get $dy) (local.get $sin))))
    (local.set $side (call $abs (local.get $lateral)))
    (local.set $width (i32.add (i32.const 1441792) (i32.div_s (local.get $distance) (i32.const 4))))
    (if (i32.ge_s (local.get $side) (local.get $width)) (then (return)))
    (if (i32.load (i32.const 4104)) (then
      (if (i32.le_s (call $terrain_toi (i32.load (local.get $p)) (i32.load offset=4 (local.get $p))
        (local.get $dx) (local.get $dy) (i32.const 0)) (i32.const 65536)) (then (return)))))
    (local.set $force (call $mul (if (result i32) (i32.load offset=52 (local.get $p)) (then (i32.const @boostExhaustForcePerSubstep@)) (else (i32.const @exhaustForcePerSubstep@)))
      (i32.div_s (i32.sub (i32.const 4194304) (local.get $distance)) (i32.const 64))))
    (local.set $force (i32.wrap_i64 (i64.div_s
      (i64.mul (i64.extend_i32_s (local.get $force)) (i64.extend_i32_s (i32.sub (local.get $width) (local.get $side))))
      (i64.extend_i32_s (local.get $width)))))
    ;; The pad absorbs downward pressure; lateral pressure slides a parked hull.
    (if (i32.load offset=32 (local.get $target)) (then
      (if (i32.ge_s (local.get $cos) (i32.const 0)) (then
        (local.set $push (i32.add (i32.sub (i32.const 0) (call $mul (local.get $sin) (local.get $force)))
          (call $mul (local.get $cos) (call $mul (local.get $force)
            (call $clamp (i32.div_s (local.get $lateral) (i32.const 32)) (i32.const 32768))))))
        ;; Blast striking the sloped hull deflects sideways, even near its center.
        (if (i32.lt_s (call $abs (local.get $push)) (i32.div_s (local.get $force) (i32.const 4))) (then
          (local.set $push (i32.mul (i32.div_s (local.get $force) (i32.const 4))
            (if (result i32) (i32.lt_s (local.get $dx) (i32.const 0)) (then (i32.const -1)) (else (i32.const 1)))))))
        (i32.store (i32.add (i32.const 40120) (i32.div_u (i32.sub (local.get $target) (i32.const 4160)) (i32.const 16)))
          (call $clamp (i32.mul (i32.const @padExhaustResponse@) (local.get $push)) (i32.const 49152)))
        (return)))
      (i32.store offset=32 (local.get $target) (i32.const 0))))
    (i32.store offset=8 (local.get $target) (call $clamp
      (i32.sub (i32.load offset=8 (local.get $target)) (call $mul (local.get $sin) (local.get $force))) (i32.const @maxSpeed@)))
    (i32.store offset=12 (local.get $target) (call $clamp
      (i32.add (i32.load offset=12 (local.get $target)) (call $mul (local.get $cos) (local.get $force))) (i32.const @maxSpeed@))))
