  ;; Resolve against expanded solid faces, including chips born inside a wall.
  (func $debris_wall (param $p i32) (param $r i32)
    (local $rect i32) (local $end i32) (local $x i32) (local $y i32)
    (local $left i32) (local $right i32) (local $top i32) (local $bottom i32) (local $near i32)
    (if (i32.eqz (i32.load (i32.const 4104))) (then (return)))
    (local.set $r (i32.add (local.get $r) (i32.const 128)))
    (local.set $rect (i32.const 32832))
    (local.set $end (i32.add (local.get $rect) (i32.mul (call $solid_count) (i32.const 16))))
    (loop $rects
      (local.set $x (i32.load (local.get $p))) (local.set $y (i32.load offset=4 (local.get $p)))
      (local.set $left (i32.sub (i32.load (local.get $rect)) (local.get $r)))
      (local.set $right (i32.add (i32.load offset=8 (local.get $rect)) (local.get $r)))
      (local.set $top (i32.sub (i32.load offset=4 (local.get $rect)) (local.get $r)))
      (local.set $bottom (i32.add (i32.load offset=12 (local.get $rect)) (local.get $r)))
      (if (i32.and (i32.and (i32.ge_s (local.get $x) (local.get $left)) (i32.le_s (local.get $x) (local.get $right)))
        (i32.and (i32.ge_s (local.get $y) (local.get $top)) (i32.le_s (local.get $y) (local.get $bottom)))) (then
        (local.set $near (call $min (call $min (i32.sub (local.get $x) (local.get $left)) (i32.sub (local.get $right) (local.get $x)))
          (call $min (i32.sub (local.get $y) (local.get $top)) (i32.sub (local.get $bottom) (local.get $y)))))
        (if (i32.eq (local.get $near) (i32.sub (local.get $x) (local.get $left))) (then
          (i32.store offset=0 (local.get $p) (i32.add (local.get $left) (i32.const -64)))
          (if (i32.gt_s (i32.load offset=8 (local.get $p)) (i32.const 0)) (then
            (i32.store offset=8 (local.get $p) (i32.div_s (i32.sub (i32.const 0) (i32.load offset=8 (local.get $p))) (i32.const 2)))))
          (return)))
        (if (i32.eq (local.get $near) (i32.sub (local.get $right) (local.get $x))) (then
          (i32.store offset=0 (local.get $p) (i32.add (local.get $right) (i32.const 64)))
          (if (i32.lt_s (i32.load offset=8 (local.get $p)) (i32.const 0)) (then
            (i32.store offset=8 (local.get $p) (i32.div_s (i32.sub (i32.const 0) (i32.load offset=8 (local.get $p))) (i32.const 2)))))
          (return)))
        (if (i32.eq (local.get $near) (i32.sub (local.get $y) (local.get $top))) (then
          (i32.store offset=4 (local.get $p) (i32.add (local.get $top) (i32.const -64)))
          (if (i32.gt_s (i32.load offset=12 (local.get $p)) (i32.const 0)) (then
            (i32.store offset=12 (local.get $p) (i32.div_s (i32.sub (i32.const 0) (i32.load offset=12 (local.get $p))) (i32.const 2)))))
          (return)))
        (if (i32.eq (local.get $near) (i32.sub (local.get $bottom) (local.get $y))) (then
          (i32.store offset=4 (local.get $p) (i32.add (local.get $bottom) (i32.const 64)))
          (if (i32.lt_s (i32.load offset=12 (local.get $p)) (i32.const 0)) (then
            (i32.store offset=12 (local.get $p) (i32.div_s (i32.sub (i32.const 0) (i32.load offset=12 (local.get $p))) (i32.const 2)))))
          (return)))
      ))
      (local.set $rect (i32.add (local.get $rect) (i32.const 16)))
      (br_if $rects (i32.lt_u (local.get $rect) (local.get $end)))))
  ;; Debris shares canonical pool slots with shots. Metadata: marker bit 28,
  ;; shape bits 0..4, orientation bits 5..16, contacted-opponent bit 17.
  (func $spawn_debris (param $p i32)
    (local $i i32) (local $slot i32) (local $table i32) (local $owner i32) (local $angle i32) (local $sin i32) (local $cos i32)
    (local.set $owner (i32.div_u (i32.sub (local.get $p) (i32.const 4160)) (i32.const 64)))
    (local.set $angle (i32.load offset=16 (local.get $p)))
    (local.set $sin (call $sin (local.get $angle))) (local.set $cos (call $sin (i32.add (local.get $angle) (i32.const 1024))))
    (local.set $slot (i32.const 4416))
    (loop $pieces
      (block $free (loop $find
        (if (i32.ge_u (local.get $slot) (i32.const 12608)) (then (return)))
        (br_if $free (i32.eqz (i32.load offset=16 (local.get $slot))))
        (local.set $slot (i32.add (local.get $slot) (i32.const 32))) (br $find)))
      (if (i32.eq (i32.load (i32.const 4108)) (i32.const 2147483647)) (then (return)))
      (local.set $table (i32.add (i32.const 36000) (i32.mul (local.get $i) (i32.const 24))))
      (i32.store offset=0 (local.get $slot) (i32.add (i32.load offset=0 (local.get $p)) (i32.sub (call $mul (i32.load offset=0 (local.get $table)) (local.get $cos)) (call $mul (i32.load offset=4 (local.get $table)) (local.get $sin)))))
      (i32.store offset=8 (local.get $slot) (i32.add (i32.load offset=0 (i32.add (i32.const 40100) (i32.mul (local.get $owner) (i32.const 8)))) (i32.sub (call $mul (i32.load offset=12 (local.get $table)) (local.get $cos)) (call $mul (i32.load offset=16 (local.get $table)) (local.get $sin)))))
      (i32.store offset=4 (local.get $slot) (i32.add (i32.load offset=4 (local.get $p)) (i32.add (call $mul (i32.load offset=0 (local.get $table)) (local.get $sin)) (call $mul (i32.load offset=4 (local.get $table)) (local.get $cos)))))
      (i32.store offset=12 (local.get $slot) (i32.add (i32.load offset=4 (i32.add (i32.const 40100) (i32.mul (local.get $owner) (i32.const 8)))) (i32.add (call $mul (i32.load offset=12 (local.get $table)) (local.get $sin)) (call $mul (i32.load offset=16 (local.get $table)) (local.get $cos)))))
      (call $debris_wall (local.get $slot) (i32.load offset=8 (local.get $table)))
      (i32.store offset=16 (local.get $slot) (i32.const 187))
      (i32.store offset=20 (local.get $slot) (local.get $owner))
      (i32.store (i32.const 4108) (i32.add (i32.load (i32.const 4108)) (i32.const 1)))
      (i32.store offset=24 (local.get $slot) (i32.load (i32.const 4108)))
      (i32.store offset=28 (local.get $slot) (i32.or (i32.const 268435456) (i32.or (i32.shl (local.get $angle) (i32.const 5)) (local.get $i))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (local.set $slot (i32.add (local.get $slot) (i32.const 32)))
      (br_if $pieces (i32.lt_u (local.get $i) (i32.const 16)))))
  (func $debris_step
    (local $slot i32) (local $meta i32) (local $table i32) (local $radius i32)
    (local $x i32) (local $y i32) (local $dx i32) (local $dy i32) (local $t i32) (local $hit i32)
    (local $shiphit i32) (local $player i32) (local $target i32) (local $old i32) (local $angle i32)
    (local.set $slot (i32.const 4416))
    (loop $pool
      (local.set $meta (i32.load offset=28 (local.get $slot)))
      (if (i32.and (i32.ne (i32.load offset=16 (local.get $slot)) (i32.const 0)) (i32.ne (local.get $meta) (i32.const 0))) (then
        (local.set $table (i32.add (i32.const 36000) (i32.mul (i32.and (local.get $meta) (i32.const 31)) (i32.const 24))))
        (local.set $radius (i32.load offset=8 (local.get $table)))
        (local.set $x (i32.load (local.get $slot))) (local.set $y (i32.load offset=4 (local.get $slot)))
        (i32.store offset=12 (local.get $slot) (call $clamp (i32.add (i32.load offset=12 (local.get $slot)) (i32.const 1729)) (i32.const 4980736)))
        (local.set $dx (i32.div_s (i32.load offset=8 (local.get $slot)) (i32.const 2)))
        (local.set $dy (i32.div_s (i32.load offset=12 (local.get $slot)) (i32.const 2)))
        (local.set $t (i32.const 65537))
        (if (i32.load (i32.const 4104)) (then
          (local.set $t (call $terrain_toi (local.get $x) (local.get $y) (local.get $dx) (local.get $dy) (local.get $radius)))))
        (local.set $player (call $nearest_target (local.get $x) (local.get $y) (local.get $dx) (local.get $dy)
          (i32.add (i32.const 1048576) (local.get $radius)) (i32.load offset=20 (local.get $slot)) (i32.const 0)))
        (local.set $target (call $ship (local.get $player)))
        (local.set $shiphit (i32.const 0))
        (local.set $hit (i32.load (i32.const 40200)))
        (if (i32.and (i32.le_s (local.get $hit) (i32.const 65536)) (i32.lt_s (local.get $hit) (local.get $t))) (then
          (local.set $t (local.get $hit))
          (local.set $shiphit (i32.const 1))
          ;; Each individual piece damages hull once; accumulate alongside shots
          ;; so deaths and kill credit resolve after both substeps.
          (if (i32.eqz (i32.and (local.get $meta) (i32.const 131072))) (then
            (i32.store (i32.add (i32.const 40000) (i32.mul (local.get $player) (i32.const 4)))
              (i32.add (i32.load (i32.add (i32.const 40000) (i32.mul (local.get $player) (i32.const 4)))) (i32.const 25)))
            (if (i32.and (i32.eq (i32.load (i32.add (i32.const 40160) (i32.mul (local.get $player) (i32.const 4)))) (i32.const -1))
              (i32.ge_s (i32.load (i32.add (i32.const 40000) (i32.mul (local.get $player) (i32.const 4)))) (i32.load offset=28 (local.get $target)))) (then
              (i32.store (i32.add (i32.const 40160) (i32.mul (local.get $player) (i32.const 4))) (i32.load offset=20 (local.get $slot)))))))
          ;; At most 2% speed loss per ship per tick, regardless of piece count.
          (if (i32.and (i32.eqz (i32.and (local.get $meta) (i32.const 131072))) (i32.eqz (i32.and (i32.load (i32.const 40132)) (i32.shl (i32.const 1) (local.get $player))))) (then
            (i32.store (i32.const 40132) (i32.or (i32.load (i32.const 40132)) (i32.shl (i32.const 1) (local.get $player))))
            (i32.store offset=8 (local.get $target) (call $mul (i32.load offset=8 (local.get $target)) (i32.const 64225)))
            (i32.store offset=12 (local.get $target) (call $mul (i32.load offset=12 (local.get $target)) (i32.const 64225)))))
          (local.set $meta (i32.or (local.get $meta) (i32.const 131072)))
        ))
        (local.set $t (call $min (local.get $t) (i32.const 65536)))
        (i32.store (local.get $slot) (call $clamp (i32.add (local.get $x) (call $mul (local.get $dx) (local.get $t))) (i32.const 1073741824)))
        (i32.store offset=4 (local.get $slot) (call $clamp (i32.add (local.get $y) (call $mul (local.get $dy) (local.get $t))) (i32.const 1073741824)))
        (if (local.get $shiphit) (then
          (call $event (i32.const 2) (i32.add (i32.load offset=24 (local.get $slot)) (i32.const 4))
            (i32.load (local.get $slot)) (i32.load offset=4 (local.get $slot))
            (i32.load offset=20 (local.get $slot)) (local.get $player))
          (memory.fill (local.get $slot) (i32.const 0) (i32.const 32)))
        (else
        (call $debris_wall (local.get $slot) (local.get $radius))
        (local.set $angle (i32.and (i32.add (i32.shr_u (local.get $meta) (i32.const 5)) (i32.load offset=20 (local.get $table))) (i32.const 4095)))
        (i32.store offset=28 (local.get $slot) (i32.or (i32.and (local.get $meta) (i32.const -131041)) (i32.shl (local.get $angle) (i32.const 5))))
        ))
      ))
      (local.set $slot (i32.add (local.get $slot) (i32.const 32)))
      (br_if $pool (i32.lt_u (local.get $slot) (i32.const 12608)))))
