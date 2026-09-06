  ;; 256 fixed projectile slots at 4416, stride 32: x,y,vx,vy,life,owner,id,reserved.
  ;; Scratch 40000: pending damage[4], crash flags[4], then old positions at 40032.
  (func $fire (param $p i32) (param $buttons i32)
    (local $slot i32) (local $angle i32) (local $owner i32)
    (if (i32.or (i32.eqz (i32.and (local.get $buttons) (i32.const 8)))
      (i32.or (i32.eqz (i32.load offset=28 (local.get $p))) (i32.load offset=36 (local.get $p)))) (then (return)))
    (if (i32.eq (i32.load (i32.const 4108)) (i32.const 2147483647)) (then (return)))
    (i32.store offset=48 (local.get $p) (i32.const 0))
    (local.set $slot (i32.const 4416))
    (block $allocated (loop $find
      (br_if $allocated (i32.eqz (i32.load offset=16 (local.get $slot))))
      (local.set $slot (i32.add (local.get $slot) (i32.const 32)))
      (if (i32.ge_u (local.get $slot) (i32.const 12608)) (then (return))) (br $find)))
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
    (call $event (i32.const 1) (i32.add (i32.load offset=24 (local.get $slot)) (i32.const 4)) (i32.load (local.get $slot)) (i32.load offset=4 (local.get $slot)) (local.get $owner) (i32.const 0))
    (i32.store offset=36 (local.get $p) (i32.const @weaponCooldown@)))
  (func $capture_positions (local $id i32)
    (loop $capture
      (memory.copy (call $old (local.get $id)) (call $ship (local.get $id)) (i32.const 8))
      (local.set $id (i32.add (local.get $id) (i32.const 1)))
      (br_if $capture (i32.lt_u (local.get $id) (call $players)))))
  ;; Find the earliest living opponent along relative swept motion. Equal times
  ;; select the lowest slot. Return its slot and write TOI to scratch 40200.
  (func $nearest_target (param $x i32) (param $y i32) (param $dx i32) (param $dy i32)
    (param $radius i32) (param $owner i32) (param $protection i32) (result i32)
    (local $id i32) (local $p i32) (local $old i32) (local $hit i32) (local $best i32) (local $selected i32)
    (local.set $best (i32.const 65537)) (local.set $selected (i32.const -1))
    (loop $targets
      (local.set $p (call $ship (local.get $id))) (local.set $old (call $old (local.get $id)))
      (if (i32.and (i32.ne (local.get $id) (local.get $owner))
        (i32.and (i32.gt_s (i32.load offset=28 (local.get $p)) (i32.const 0))
          (i32.eqz (i32.and (local.get $protection) (i32.gt_s (i32.load offset=48 (local.get $p)) (i32.const 0)))))) (then
        (local.set $hit (call $circle_toi
          (i32.sub (local.get $x) (i32.load (local.get $old)))
          (i32.sub (local.get $y) (i32.load offset=4 (local.get $old)))
          (i32.sub (local.get $dx) (i32.sub (i32.load (local.get $p)) (i32.load (local.get $old))))
          (i32.sub (local.get $dy) (i32.sub (i32.load offset=4 (local.get $p)) (i32.load offset=4 (local.get $old))))
          (i32.const 0) (i32.const 0) (local.get $radius)))
        (if (i32.lt_s (local.get $hit) (local.get $best)) (then
          (local.set $best (local.get $hit)) (local.set $selected (local.get $id))))))
      (local.set $id (i32.add (local.get $id) (i32.const 1)))
      (br_if $targets (i32.lt_u (local.get $id) (call $players))))
    (i32.store (i32.const 40200) (local.get $best)) (local.get $selected))
  ;; Collect pair contacts before moving any hull, avoiding slot-order changes
  ;; to the sweeps. Each hull stops at its earliest contact and crashes once.
  (func $ship_contact
    (local $a i32) (local $b i32) (local $p i32) (local $q i32) (local $old i32) (local $other i32) (local $t i32)
    (local.set $a (i32.const 0))
    (loop $clear_contacts
      (i32.store (i32.add (i32.const 40216) (i32.mul (local.get $a) (i32.const 4))) (i32.const 65537))
      (local.set $a (i32.add (local.get $a) (i32.const 1)))
      (br_if $clear_contacts (i32.lt_u (local.get $a) (call $players))))
    (local.set $a (i32.const 0))
    (loop $first
      (local.set $b (i32.add (local.get $a) (i32.const 1)))
      (block $pairs_done (loop $second
        (br_if $pairs_done (i32.ge_u (local.get $b) (call $players)))
        (local.set $p (call $ship (local.get $a))) (local.set $q (call $ship (local.get $b)))
        (local.set $old (call $old (local.get $a))) (local.set $other (call $old (local.get $b)))
        (if (i32.and (i32.gt_s (i32.load offset=28 (local.get $p)) (i32.const 0)) (i32.gt_s (i32.load offset=28 (local.get $q)) (i32.const 0))) (then
          (local.set $t (call $circle_toi
            (i32.sub (i32.load (local.get $old)) (i32.load (local.get $other)))
            (i32.sub (i32.load offset=4 (local.get $old)) (i32.load offset=4 (local.get $other)))
            (i32.sub (i32.sub (i32.load (local.get $p)) (i32.load (local.get $old))) (i32.sub (i32.load (local.get $q)) (i32.load (local.get $other))))
            (i32.sub (i32.sub (i32.load offset=4 (local.get $p)) (i32.load offset=4 (local.get $old))) (i32.sub (i32.load offset=4 (local.get $q)) (i32.load offset=4 (local.get $other))))
            (i32.const 0) (i32.const 0) (i32.const 2097152)))
          (i32.store (i32.add (i32.const 40216) (i32.mul (local.get $a) (i32.const 4)))
            (call $min (local.get $t) (i32.load (i32.add (i32.const 40216) (i32.mul (local.get $a) (i32.const 4))))))
          (i32.store (i32.add (i32.const 40216) (i32.mul (local.get $b) (i32.const 4)))
            (call $min (local.get $t) (i32.load (i32.add (i32.const 40216) (i32.mul (local.get $b) (i32.const 4))))))))
        (local.set $b (i32.add (local.get $b) (i32.const 1))) (br $second)))
      (local.set $a (i32.add (local.get $a) (i32.const 1)))
      (br_if $first (i32.lt_u (local.get $a) (call $players))))
    (local.set $a (i32.const 0))
    (loop $apply_contacts
      (local.set $t (i32.load (i32.add (i32.const 40216) (i32.mul (local.get $a) (i32.const 4)))))
      (if (i32.le_s (local.get $t) (i32.const 65536)) (then
        (local.set $p (call $ship (local.get $a))) (local.set $old (call $old (local.get $a)))
        (i32.store (local.get $p) (i32.add (i32.load (local.get $old)) (call $mul (i32.sub (i32.load (local.get $p)) (i32.load (local.get $old))) (local.get $t))))
        (i32.store offset=4 (local.get $p) (i32.add (i32.load offset=4 (local.get $old)) (call $mul (i32.sub (i32.load offset=4 (local.get $p)) (i32.load offset=4 (local.get $old))) (local.get $t))))
        (i32.store offset=8 (local.get $p) (i32.const 0)) (i32.store offset=12 (local.get $p) (i32.const 0)) (i32.store offset=20 (local.get $p) (i32.const 0))
        (i32.store (call $crash_ptr (local.get $a)) (i32.const 1))))
      (local.set $a (i32.add (local.get $a) (i32.const 1)))
      (br_if $apply_contacts (i32.lt_u (local.get $a) (call $players)))))
  (func $projectiles
    (local $slot i32) (local $x i32) (local $y i32) (local $dx i32) (local $dy i32)
    (local $terrain i32) (local $hit i32) (local $target i32) (local $old i32) (local $player i32)
    (local.set $slot (i32.const 4416))
    (loop $pool
      (if (i32.and (i32.ne (i32.load offset=16 (local.get $slot)) (i32.const 0)) (i32.eqz (i32.load offset=28 (local.get $slot)))) (then
        (local.set $x (i32.load (local.get $slot))) (local.set $y (i32.load offset=4 (local.get $slot)))
        (local.set $dx (i32.div_s (i32.load offset=8 (local.get $slot)) (i32.const 2)))
        (local.set $dy (i32.div_s (i32.load offset=12 (local.get $slot)) (i32.const 2)))
        (local.set $terrain (i32.const 65537))
        (if (i32.load (i32.const 4104)) (then
          (local.set $terrain (call $terrain_toi (local.get $x) (local.get $y) (local.get $dx) (local.get $dy) (i32.const 0)))))
        (local.set $player (call $nearest_target (local.get $x) (local.get $y) (local.get $dx) (local.get $dy)
          (i32.const 1048576) (i32.load offset=20 (local.get $slot)) (i32.const 1)))
        (local.set $hit (i32.load (i32.const 40200)))
        (if (i32.or (i32.le_s (local.get $terrain) (i32.const 65536)) (i32.le_s (local.get $hit) (i32.const 65536)))
          (then
            ;; Terrain wins equal TOI; ship damage remains pending until both substeps finish.
            (if (i32.lt_s (local.get $hit) (local.get $terrain)) (then
              (i32.store (i32.add (i32.const 40000) (i32.mul (local.get $player) (i32.const 4)))
                (i32.add (i32.load (i32.add (i32.const 40000) (i32.mul (local.get $player) (i32.const 4)))) (i32.const 1)))
              ;; Credit the shot that first reaches lethal pending damage, in
              ;; deterministic substep/projectile-slot order, preserving trades.
              (if (i32.eq (i32.load (i32.add (i32.const 40000) (i32.mul (local.get $player) (i32.const 4))))
                (i32.load offset=28 (call $ship (local.get $player)))) (then
                (i32.store (i32.add (i32.const 40160) (i32.mul (local.get $player) (i32.const 4))) (i32.load offset=20 (local.get $slot)))))))
            (call $event (if (result i32) (i32.lt_s (local.get $hit) (local.get $terrain)) (then (i32.const 2)) (else (i32.const 3)))
              (i32.add (i32.load offset=24 (local.get $slot)) (i32.const 4))
              (i32.add (local.get $x) (call $mul (local.get $dx) (call $min (local.get $hit) (local.get $terrain))))
              (i32.add (local.get $y) (call $mul (local.get $dy) (call $min (local.get $hit) (local.get $terrain))))
              (i32.load offset=20 (local.get $slot)) (local.get $player))
            (memory.fill (local.get $slot) (i32.const 0) (i32.const 32)))
          (else
            (i32.store (local.get $slot) (i32.add (local.get $x) (local.get $dx)))
            (i32.store offset=4 (local.get $slot) (i32.add (local.get $y) (local.get $dy)))))))
      (local.set $slot (i32.add (local.get $slot) (i32.const 32)))
      (br_if $pool (i32.lt_u (local.get $slot) (i32.const 12608)))))
  (func $damage (param $p i32) (param $amount i32) (param $opponent i32)
    (if (i32.or (i32.eqz (local.get $amount)) (i32.eqz (i32.load offset=28 (local.get $p)))) (then (return)))
    (i32.store offset=28 (local.get $p) (call $max (i32.const 0) (i32.sub (i32.load offset=28 (local.get $p)) (local.get $amount))))
    (if (i32.eqz (i32.load offset=28 (local.get $p))) (then
      (call $ship_event (i32.const 4) (local.get $p) (i32.const 0))
      (call $spawn_debris (local.get $p))
      (i32.store offset=8 (local.get $p) (i32.const 0)) (i32.store offset=12 (local.get $p) (i32.const 0))
      (i32.store offset=20 (local.get $p) (i32.const 0)) (i32.store offset=32 (local.get $p) (i32.const 0))
      (i32.store offset=40 (local.get $p) (i32.const 120)) (i32.store offset=48 (local.get $p) (i32.const 0))
      (i32.store offset=44 (local.get $opponent) (i32.add (i32.load offset=44 (local.get $opponent)) (i32.const 1))))))
  (func $crash (param $p i32)
    (call $ship_event (i32.const 5) (local.get $p) (i32.const 0))
    (call $spawn_debris (local.get $p))
    (i32.store offset=48 (local.get $p) (i32.const 0))
    (i32.store offset=28 (local.get $p) (i32.const 0))
    (i32.store offset=32 (local.get $p) (i32.const 0))
    (i32.store offset=40 (local.get $p) (i32.const 120))
    (i32.store offset=44 (local.get $p) (i32.sub (i32.load offset=44 (local.get $p)) (i32.const 1))))
  ;; A unique highest score of at least five wins. Top-score ties continue.
  (func $winner (param $state i32) (result i32)
    (local $id i32) (local $score i32) (local $best i32) (local $winner i32)
    (local.set $best (i32.const 4)) (local.set $winner (i32.const -1))
    (loop $leaders
      (local.set $score (i32.load offset=108 (i32.add (local.get $state) (i32.mul (local.get $id) (i32.const 64)))))
      (if (i32.eq (local.get $score) (local.get $best)) (then (local.set $winner (i32.const -1))))
      (if (i32.gt_s (local.get $score) (local.get $best)) (then (local.set $best (local.get $score)) (local.set $winner (local.get $id))))
      (local.set $id (i32.add (local.get $id) (i32.const 1)))
      (br_if $leaders (i32.lt_u (local.get $id) (call $players)))) (local.get $winner))
  (func $finish_combat
    (local $slot i32) (local $id i32) (local $owner i32) (local $winner i32)
    ;; Terrain and hull crashes take precedence over projectile deaths.
    (loop $crashes
      (if (i32.load (call $crash_ptr (local.get $id))) (then (call $crash (call $ship (local.get $id)))))
      (local.set $id (i32.add (local.get $id) (i32.const 1)))
      (br_if $crashes (i32.lt_u (local.get $id) (call $players))))
    (local.set $id (i32.const 0))
    (loop $damage_all
      (local.set $owner (i32.load (i32.add (i32.const 40160) (i32.mul (local.get $id) (i32.const 4)))))
      (call $damage (call $ship (local.get $id)) (i32.load (i32.add (i32.const 40000) (i32.mul (local.get $id) (i32.const 4)))) (call $ship (local.get $owner)))
      (local.set $id (i32.add (local.get $id) (i32.const 1)))
      (br_if $damage_all (i32.lt_u (local.get $id) (call $players))))
    (local.set $slot (i32.const 4416))
    (loop $age
      (if (i32.load offset=16 (local.get $slot)) (then
        (i32.store offset=16 (local.get $slot) (i32.sub (i32.load offset=16 (local.get $slot)) (i32.const 1)))
        (if (i32.eqz (i32.load offset=16 (local.get $slot))) (then (memory.fill (local.get $slot) (i32.const 0) (i32.const 32))))))
      (local.set $slot (i32.add (local.get $slot) (i32.const 32))) (br_if $age (i32.lt_u (local.get $slot) (i32.const 12608))))
    (local.set $winner (call $winner (i32.const 4096)))
    (i32.store (i32.const 4100) (local.get $winner))
    (if (i32.ge_s (local.get $winner) (i32.const 0)) (then
      (call $ship_event (i32.const 8) (call $ship (local.get $winner)) (i32.load offset=44 (call $ship (local.get $winner)))))))
