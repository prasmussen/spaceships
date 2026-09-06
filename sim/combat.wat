  ;; 256 fixed projectile slots at 4288, stride 32: x,y,vx,vy,life,owner,id,reserved.
  ;; Scratch 40000: pending damage[2], then old positions at 40016.
  (func $fire (param $p i32) (param $buttons i32)
    (local $slot i32) (local $angle i32) (local $owner i32)
    (if (i32.or (i32.eqz (i32.and (local.get $buttons) (i32.const 8)))
      (i32.or (i32.eqz (i32.load offset=28 (local.get $p))) (i32.load offset=36 (local.get $p)))) (then (return)))
    (if (i32.eq (i32.load (i32.const 4108)) (i32.const 2147483647)) (then (return)))
    (i32.store offset=48 (local.get $p) (i32.const 0))
    (local.set $slot (i32.const 4288))
    (block $allocated (loop $find
      (br_if $allocated (i32.eqz (i32.load offset=16 (local.get $slot))))
      (local.set $slot (i32.add (local.get $slot) (i32.const 32)))
      (if (i32.ge_u (local.get $slot) (i32.const 12480)) (then (return))) (br $find)))
    (local.set $owner (i32.div_u (i32.sub (local.get $p) (i32.const 4160)) (i32.const 64)))
    (local.set $angle (i32.load offset=16 (local.get $p)))
    (i32.store (local.get $slot) (i32.add (i32.load (local.get $p)) (call $mul (call $sin (local.get $angle)) (i32.const 1310720))))
    (i32.store offset=4 (local.get $slot) (i32.sub (i32.load offset=4 (local.get $p)) (call $mul (call $sin (i32.add (local.get $angle) (i32.const 1024))) (i32.const 1310720))))
    (i32.store offset=8 (local.get $slot) (i32.add (i32.load offset=8 (local.get $p)) (call $mul (call $sin (local.get $angle)) (i32.const @muzzleSpeed@))))
    (i32.store offset=12 (local.get $slot) (i32.sub (i32.load offset=12 (local.get $p)) (call $mul (call $sin (i32.add (local.get $angle) (i32.const 1024))) (i32.const @muzzleSpeed@))))
    (i32.store offset=16 (local.get $slot) (i32.const @projectileLifetime@))
    (i32.store offset=20 (local.get $slot) (local.get $owner))
    (i32.store (i32.const 4108) (i32.add (i32.load (i32.const 4108)) (i32.const 1)))
    (i32.store offset=24 (local.get $slot) (i32.load (i32.const 4108)))
    (call $event (i32.const 1) (i32.add (i32.load offset=24 (local.get $slot)) (i32.const 2)) (i32.load (local.get $slot)) (i32.load offset=4 (local.get $slot)) (local.get $owner) (i32.const 0))
    (i32.store offset=36 (local.get $p) (i32.const @weaponCooldown@)))
  (func $capture_positions
    (memory.copy (i32.const 40016) (i32.const 4160) (i32.const 8))
    (memory.copy (i32.const 40024) (i32.const 4224) (i32.const 8)))
  (func $projectiles
    (local $slot i32) (local $x i32) (local $y i32) (local $dx i32) (local $dy i32)
    (local $terrain i32) (local $hit i32) (local $target i32) (local $old i32) (local $player i32)
    (local.set $slot (i32.const 4288))
    (loop $pool
      (if (i32.load offset=16 (local.get $slot)) (then
        (local.set $x (i32.load (local.get $slot))) (local.set $y (i32.load offset=4 (local.get $slot)))
        (local.set $dx (i32.div_s (i32.load offset=8 (local.get $slot)) (i32.const 2)))
        (local.set $dy (i32.div_s (i32.load offset=12 (local.get $slot)) (i32.const 2)))
        (local.set $terrain (i32.const 65537))
        (if (i32.load (i32.const 4104)) (then
          (local.set $terrain (call $terrain_toi (local.get $x) (local.get $y) (local.get $dx) (local.get $dy) (i32.const 0)))))
        (local.set $player (i32.sub (i32.const 1) (i32.load offset=20 (local.get $slot))))
        (local.set $target (i32.add (i32.const 4160) (i32.mul (local.get $player) (i32.const 64))))
        (local.set $old (i32.add (i32.const 40016) (i32.mul (local.get $player) (i32.const 8))))
        (local.set $hit (i32.const 65537))
        (if (i32.and (i32.gt_s (i32.load offset=28 (local.get $target)) (i32.const 0)) (i32.eqz (i32.load offset=48 (local.get $target)))) (then
          (local.set $hit (call $circle_toi
            (i32.sub (local.get $x) (i32.load (local.get $old)))
            (i32.sub (local.get $y) (i32.load offset=4 (local.get $old)))
            (i32.sub (local.get $dx) (i32.sub (i32.load (local.get $target)) (i32.load (local.get $old))))
            (i32.sub (local.get $dy) (i32.sub (i32.load offset=4 (local.get $target)) (i32.load offset=4 (local.get $old))))
            (i32.const 0) (i32.const 0) (i32.const 1048576)))))
        (if (i32.or (i32.le_s (local.get $terrain) (i32.const 65536)) (i32.le_s (local.get $hit) (i32.const 65536)))
          (then
            ;; Terrain wins equal TOI; ship damage remains pending until both substeps finish.
            (if (i32.lt_s (local.get $hit) (local.get $terrain)) (then
              (i32.store (i32.add (i32.const 40000) (i32.mul (local.get $player) (i32.const 4)))
                (i32.add (i32.load (i32.add (i32.const 40000) (i32.mul (local.get $player) (i32.const 4)))) (i32.const 1)))))
            (call $event (if (result i32) (i32.lt_s (local.get $hit) (local.get $terrain)) (then (i32.const 2)) (else (i32.const 3)))
              (i32.add (i32.load offset=24 (local.get $slot)) (i32.const 2))
              (i32.add (local.get $x) (call $mul (local.get $dx) (call $min (local.get $hit) (local.get $terrain))))
              (i32.add (local.get $y) (call $mul (local.get $dy) (call $min (local.get $hit) (local.get $terrain))))
              (i32.load offset=20 (local.get $slot)) (local.get $player))
            (memory.fill (local.get $slot) (i32.const 0) (i32.const 32)))
          (else
            (i32.store (local.get $slot) (i32.add (local.get $x) (local.get $dx)))
            (i32.store offset=4 (local.get $slot) (i32.add (local.get $y) (local.get $dy)))))))
      (local.set $slot (i32.add (local.get $slot) (i32.const 32)))
      (br_if $pool (i32.lt_u (local.get $slot) (i32.const 12480)))))
  (func $damage (param $p i32) (param $amount i32) (param $opponent i32)
    (if (i32.or (i32.eqz (local.get $amount)) (i32.eqz (i32.load offset=28 (local.get $p)))) (then (return)))
    (i32.store offset=28 (local.get $p) (call $max (i32.const 0) (i32.sub (i32.load offset=28 (local.get $p)) (local.get $amount))))
    (if (i32.eqz (i32.load offset=28 (local.get $p))) (then
      (call $ship_event (i32.const 4) (local.get $p) (i32.const 0))
      (i32.store offset=8 (local.get $p) (i32.const 0)) (i32.store offset=12 (local.get $p) (i32.const 0))
      (i32.store offset=20 (local.get $p) (i32.const 0)) (i32.store offset=32 (local.get $p) (i32.const 0))
      (i32.store offset=40 (local.get $p) (i32.const 120)) (i32.store offset=48 (local.get $p) (i32.const 0))
      (i32.store offset=44 (local.get $opponent) (i32.add (i32.load offset=44 (local.get $opponent)) (i32.const 1))))))
  (func $crash (param $p i32)
    (call $ship_event (i32.const 5) (local.get $p) (i32.const 0))
    (i32.store offset=48 (local.get $p) (i32.const 0))
    (i32.store offset=28 (local.get $p) (i32.const 0))
    (i32.store offset=32 (local.get $p) (i32.const 0))
    (i32.store offset=40 (local.get $p) (i32.const 120))
    (i32.store offset=44 (local.get $p) (i32.sub (i32.load offset=44 (local.get $p)) (i32.const 1))))
  (func $finish_combat
    (local $slot i32) (local $a i32) (local $b i32)
    ;; All contact/damage is collected first. A same-tick terrain crash takes
    ;; precedence over projectile death for cause/scoring, independent of player order.
    (if (i32.load (i32.const 40008)) (then (call $crash (i32.const 4160))))
    (if (i32.load (i32.const 40012)) (then (call $crash (i32.const 4224))))
    (call $damage (i32.const 4160) (i32.load (i32.const 40000)) (i32.const 4224))
    (call $damage (i32.const 4224) (i32.load (i32.const 40004)) (i32.const 4160))
    (local.set $slot (i32.const 4288))
    (loop $age
      (if (i32.load offset=16 (local.get $slot)) (then
        (i32.store offset=16 (local.get $slot) (i32.sub (i32.load offset=16 (local.get $slot)) (i32.const 1)))
        (if (i32.eqz (i32.load offset=16 (local.get $slot))) (then (memory.fill (local.get $slot) (i32.const 0) (i32.const 32))))))
      (local.set $slot (i32.add (local.get $slot) (i32.const 32))) (br_if $age (i32.lt_u (local.get $slot) (i32.const 12480))))
    (local.set $a (i32.load (i32.const 4204))) (local.set $b (i32.load (i32.const 4268)))
    (if (i32.and (i32.ge_s (local.get $a) (i32.const 5)) (i32.gt_s (local.get $a) (local.get $b))) (then (i32.store (i32.const 4100) (i32.const 0)) (call $ship_event (i32.const 8) (i32.const 4160) (local.get $a))))
    (if (i32.and (i32.ge_s (local.get $b) (i32.const 5)) (i32.gt_s (local.get $b) (local.get $a))) (then (i32.store (i32.const 4100) (i32.const 1)) (call $ship_event (i32.const 8) (i32.const 4224) (local.get $b)))))
