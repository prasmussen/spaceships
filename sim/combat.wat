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
          (i32.eqz (i32.and (local.get $protection) (i32.and (i32.gt_s (i32.load offset=48 (local.get $p)) (i32.const 0)) (i32.eqz (i32.load8_u (call $aux (local.get $p))))))))) (then
        (local.set $hit (call $circle_toi
          (i32.sub (local.get $x) (i32.load (local.get $old)))
          (i32.sub (local.get $y) (i32.load offset=4 (local.get $old)))
          (i32.sub (local.get $dx) (i32.sub (i32.load (local.get $p)) (i32.load (local.get $old))))
          (i32.sub (local.get $dy) (i32.sub (i32.load offset=4 (local.get $p)) (i32.load offset=4 (local.get $old))))
          (i32.const 0) (i32.const 0)
          (if (result i32) (i32.and (local.get $protection) (i32.ne (i32.load8_u (call $aux (local.get $p))) (i32.const 0)))
            (then (i32.const 1507328)) (else (local.get $radius)))))
        (if (i32.lt_s (local.get $hit) (local.get $best)) (then
          (local.set $best (local.get $hit)) (local.set $selected (local.get $id))))))
      (local.set $id (i32.add (local.get $id) (i32.const 1)))
      (br_if $targets (i32.lt_u (local.get $id) (call $players))))
    (i32.store (i32.const 40200) (local.get $best)) (local.get $selected))
  ;; Collect sweeps before changing positions. Stop at each hull's earliest
  ;; contact, then resolve reachable pairs in slot order (including ties).
  ;; Pair times use 40300..40363, a four-by-four i32 scratch matrix.
  (func $ship_contact
    (local $a i32) (local $b i32) (local $p i32) (local $q i32) (local $old i32) (local $other i32) (local $t i32)
    (memory.fill (i32.const 40300) (i32.const 255) (i32.const 64))
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
          (i32.store (call $pair_time (local.get $a) (local.get $b)) (local.get $t))
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
        ))
      (local.set $a (i32.add (local.get $a) (i32.const 1)))
      (br_if $apply_contacts (i32.lt_u (local.get $a) (call $players))))
    (local.set $a (i32.const 0))
    (loop $resolve_first
      (local.set $b (i32.add (local.get $a) (i32.const 1)))
      (block $resolve_done (loop $resolve_second
        (br_if $resolve_done (i32.ge_u (local.get $b) (call $players)))
        (local.set $t (i32.load (call $pair_time (local.get $a) (local.get $b))))
        ;; A previous contact can truncate a trajectory before this pair meets.
        (if (i32.and (i32.le_u (local.get $t) (i32.const 65536)) (i32.and
          (i32.eq (local.get $t) (i32.load (i32.add (i32.const 40216) (i32.mul (local.get $a) (i32.const 4)))))
          (i32.eq (local.get $t) (i32.load (i32.add (i32.const 40216) (i32.mul (local.get $b) (i32.const 4))))))) (then
          (local.set $p (call $ship (local.get $a))) (local.set $q (call $ship (local.get $b)))
          (if (i32.or (i32.load8_u (call $aux (local.get $p))) (i32.load8_u (call $aux (local.get $q))))
            (then (call $ship_rebound (local.get $p) (local.get $q)))
            (else
              (call $contact_crash (local.get $a)) (call $contact_crash (local.get $b))))))
        (local.set $b (i32.add (local.get $b) (i32.const 1))) (br $resolve_second)))
      (local.set $a (i32.add (local.get $a) (i32.const 1)))
      (br_if $resolve_first (i32.lt_u (local.get $a) (call $players)))))
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
              (if (i32.load8_u (call $aux (call $ship (local.get $player))))
                (then (i32.store8 offset=1 (call $aux (call $ship (local.get $player))) (i32.const 12)))
                (else
              (i32.store (i32.add (i32.const 40000) (i32.mul (local.get $player) (i32.const 4)))
                (i32.add (i32.load (i32.add (i32.const 40000) (i32.mul (local.get $player) (i32.const 4)))) (i32.const @projectileDamage@)))
              ;; Credit the shot that first reaches lethal pending damage, in
              ;; deterministic substep/projectile-slot order, preserving trades.
              (if (i32.and (i32.eq (i32.load (i32.add (i32.const 40160) (i32.mul (local.get $player) (i32.const 4)))) (i32.const -1)) (i32.ge_s (i32.load (i32.add (i32.const 40000) (i32.mul (local.get $player) (i32.const 4))))
                (i32.load offset=28 (call $ship (local.get $player))))) (then
                (i32.store (i32.add (i32.const 40160) (i32.mul (local.get $player) (i32.const 4))) (i32.load offset=20 (local.get $slot)))))))))
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
    (i32.store16 offset=4 (call $aux (local.get $p)) (i32.const @repairDelay@))
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
      (call $repair (call $ship (local.get $id)))
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

  (func $pair_time (param $a i32) (param $b i32) (result i32)
    (i32.add (i32.const 40300) (i32.add (i32.mul (local.get $a) (i32.const 16)) (i32.mul (local.get $b) (i32.const 4)))))
  (func $contact_crash (param $id i32)
    (local $p i32) (local.set $p (call $ship (local.get $id)))
    (i32.store offset=8 (local.get $p) (i32.const 0))
    (i32.store offset=12 (local.get $p) (i32.const 0))
    (i32.store offset=20 (local.get $p) (i32.const 0))
    (i32.store (call $crash_ptr (local.get $id)) (i32.const 1)))
  ;; Separation is swept through terrain. Pads absorb downward pressure and
  ;; retain their normal sliding limit; upward rebounds release grounding.
  (func $rebound_separate (param $p i32) (param $dx i32) (param $dy i32)
    (if (i32.load offset=32 (local.get $p)) (then
      (if (i32.lt_s (i32.load offset=12 (local.get $p)) (i32.const 0))
        (then (i32.store offset=32 (local.get $p) (i32.const 0)) (i32.store offset=48 (local.get $p) (i32.const 0)))
        (else
          (local.set $dy (i32.const 0))
          (i32.store offset=8 (local.get $p) (call $clamp (i32.load offset=8 (local.get $p)) (i32.const 98304)))
          (i32.store offset=12 (local.get $p) (i32.const 0))))))
    (if (i32.load (i32.const 4104))
      (then (call $move (local.get $p) (local.get $dx) (local.get $dy)))
      (else
        (i32.store (local.get $p) (call $clamp (i32.add (i32.load (local.get $p)) (local.get $dx)) (i32.const @maxPosition@)))
        (i32.store offset=4 (local.get $p) (call $clamp (i32.add (i32.load offset=4 (local.get $p)) (local.get $dy)) (i32.const @maxPosition@)))))
    (if (i32.and (i32.load offset=32 (local.get $p)) (i32.eqz (call $pad_at (i32.load (local.get $p)) (i32.load offset=4 (local.get $p))))) (then
      (i32.store offset=32 (local.get $p) (i32.const 0)) (i32.store offset=48 (local.get $p) (i32.const 0)))))
  (func $ship_rebound (param $p i32) (param $q i32)
    (local $nx i32) (local $ny i32) (local $vx i32) (local $vy i32)
    (local $length i32) (local $lo i32) (local $hi i32) (local $mid i32) (local $gap i32)
    (local $dot i64) (local $d2 i64) (local $impulse i32) (local $ix i32) (local $iy i32) (local $pm i32) (local $qm i32)
    (local.set $nx (i32.sub (i32.load (local.get $p)) (i32.load (local.get $q))))
    (local.set $ny (i32.sub (i32.load offset=4 (local.get $p)) (i32.load offset=4 (local.get $q))))
    (local.set $vx (i32.sub (i32.load offset=8 (local.get $p)) (i32.load offset=8 (local.get $q))))
    (local.set $vy (i32.sub (i32.load offset=12 (local.get $p)) (i32.load offset=12 (local.get $q))))
    ;; Coincident centers use the opposite relative velocity, then slot order.
    (if (i32.eqz (i32.or (local.get $nx) (local.get $ny))) (then
      (local.set $nx (i32.sub (i32.const 0) (local.get $vx))) (local.set $ny (i32.sub (i32.const 0) (local.get $vy)))
      (if (i32.eqz (i32.or (local.get $nx) (local.get $ny))) (then (local.set $nx (i32.const -65536))))))
    ;; Normalize by the largest component to keep dot products bounded even
    ;; for nearly coincident centers. Equal masses, restitution 0.75.
    (local.set $length (call $max (call $abs (local.get $nx)) (call $abs (local.get $ny))))
    (local.set $nx (i32.wrap_i64 (i64.div_s (i64.mul (i64.extend_i32_s (local.get $nx)) (i64.const 65536)) (i64.extend_i32_s (local.get $length)))))
    (local.set $ny (i32.wrap_i64 (i64.div_s (i64.mul (i64.extend_i32_s (local.get $ny)) (i64.const 65536)) (i64.extend_i32_s (local.get $length)))))
    (local.set $d2 (call $dist2 (local.get $nx) (local.get $ny)))
    (local.set $dot (i64.add (i64.mul (i64.extend_i32_s (local.get $nx)) (i64.extend_i32_s (local.get $vx)))
      (i64.mul (i64.extend_i32_s (local.get $ny)) (i64.extend_i32_s (local.get $vy)))))
    (if (i64.lt_s (local.get $dot) (i64.const 0)) (then
      (local.set $impulse (i32.wrap_i64 (i64.div_s (i64.mul (local.get $dot) (i64.const 57344)) (local.get $d2))))
      (local.set $ix (call $mul (local.get $nx) (local.get $impulse)))
      (local.set $iy (call $mul (local.get $ny) (local.get $impulse)))
      (local.set $pm (i32.const 1)) (local.set $qm (i32.const 1))
      ;; A pad supports downward pressure as an immovable surface. Transfer
      ;; that share of the impulse back to the incoming ship instead.
      (if (i32.and (i32.load offset=32 (local.get $q)) (i32.gt_s (local.get $iy) (i32.const 0))) (then
        (local.set $pm (i32.const 2)) (local.set $qm (i32.const 0))))
      (if (i32.and (i32.load offset=32 (local.get $p)) (i32.lt_s (local.get $iy) (i32.const 0))) (then
        (local.set $pm (i32.const 0)) (local.set $qm (i32.const 2))))
      (i32.store offset=8 (local.get $p) (call $clamp (i32.sub (i32.load offset=8 (local.get $p)) (i32.mul (local.get $ix) (local.get $pm))) (i32.const @maxSpeed@)))
      (i32.store offset=12 (local.get $p) (call $clamp (i32.sub (i32.load offset=12 (local.get $p)) (i32.mul (local.get $iy) (local.get $pm))) (i32.const @maxSpeed@)))
      (i32.store offset=8 (local.get $q) (call $clamp (i32.add (i32.load offset=8 (local.get $q)) (i32.mul (local.get $ix) (local.get $qm))) (i32.const @maxSpeed@)))
      (i32.store offset=12 (local.get $q) (call $clamp (i32.add (i32.load offset=12 (local.get $q)) (i32.mul (local.get $iy) (local.get $qm))) (i32.const @maxSpeed@)))))
    ;; Integer square root of the actual distance for overlap correction.
    (local.set $d2 (call $dist2 (i32.sub (i32.load (local.get $p)) (i32.load (local.get $q)))
      (i32.sub (i32.load offset=4 (local.get $p)) (i32.load offset=4 (local.get $q)))))
    (local.set $hi (i32.const 2097280))
    (loop $sqrt
      (local.set $mid (i32.div_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 2)))
      (if (i64.le_u (call $dist2 (local.get $mid) (i32.const 0)) (local.get $d2))
        (then (local.set $lo (local.get $mid))) (else (local.set $hi (local.get $mid))))
      (br_if $sqrt (i32.gt_u (i32.sub (local.get $hi) (local.get $lo)) (i32.const 1))))
    (local.set $gap (call $max (i32.const 128) (i32.div_s (i32.sub (i32.const 2097408) (local.get $lo)) (i32.const 2))))
    (local.set $ix (call $mul (local.get $nx) (local.get $gap)))
    (local.set $iy (call $mul (local.get $ny) (local.get $gap)))
    (call $rebound_separate (local.get $p) (local.get $ix) (local.get $iy))
    (call $rebound_separate (local.get $q) (i32.sub (i32.const 0) (local.get $ix)) (i32.sub (i32.const 0) (local.get $iy)))
    (if (i32.load8_u (call $aux (local.get $p))) (then (i32.store8 offset=1 (call $aux (local.get $p)) (i32.const 12))))
    (if (i32.load8_u (call $aux (local.get $q))) (then (i32.store8 offset=1 (call $aux (local.get $q)) (i32.const 12)))))
