struct View { size: vec2f, camera: vec2f, mode:f32, padding:f32 };
struct Ship { position:vec2f, angle:f32, alive:f32, thrust:f32, protection:f32, padding:vec2f };
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage,read> terrain: array<vec4f>;
@group(0) @binding(2) var<storage,read> ships: array<Ship>;
@group(0) @binding(3) var<storage,read> bullets: array<vec4f>;
@vertex fn vs(@builtin(vertex_index) i:u32) -> @builtin(position) vec4f {
  let p = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1);
}
fn line(p:vec2f, a:vec2f, b:vec2f)->f32 {
  let ab=b-a; return length(p-a-ab*clamp(dot(p-a,ab)/dot(ab,ab),0.,1.));
}
fn tint(player:u32)->vec3f { return select(vec3f(.18,.85,.72),vec3f(1.,.48,.25),player==1u); }
@fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f {
  let world=pos.xy-view.size*.5+view.camera;
  let grid=abs(fract(world/100.+.5)-.5)*100.;
  var color=vec3f(.025,.044,.062);
  if(min(grid.x,grid.y)<.7){color+=vec3f(.025,.044,.05);}
  if(view.mode>.5) {
    for(var i=0u;i<arrayLength(&terrain)-2u;i++) {
      let rect=terrain[i];
      if(world.x>=rect.x && world.x<=rect.z && world.y>=rect.y && world.y<=rect.w) {
        color=vec3f(.075,.12,.15);
        let rim=min(min(world.x-rect.x,rect.z-world.x),min(world.y-rect.y,rect.w-world.y));
        color+=vec3f(.08,.14,.16)*exp(-rim*.5);
      }
    }
    for(var player=0u;player<2u;player++) {
      let pad=terrain[arrayLength(&terrain)-2u+player];
      color+=tint(player)*exp(-line(world,pad.xy,pad.zw)*.2);
    }
  }
  for(var player=0u;player<2u;player++) {
    let ship=ships[player];
    if(ship.alive<.5){continue;}
    let local=world-ship.position;
    let c=cos(ship.angle); let s=sin(ship.angle);
    let p=vec2f(c*local.x+s*local.y,-s*local.x+c*local.y);
    let edge=min(line(p,vec2f(0,-17),vec2f(-12,12)),min(line(p,vec2f(-12,12),vec2f(0,7)),min(line(p,vec2f(0,7),vec2f(12,12)),line(p,vec2f(12,12),vec2f(0,-17)))));
    color+=tint(player)*exp(-edge*.8);
    if(ship.thrust>.5 && p.y>10. && p.y<31. && abs(p.x)<(31.-p.y)*.21){color=vec3f(1.,.55,.2);}
    if(ship.protection>.5){color+=tint(player)*.45*exp(-abs(length(local)-24.));}
  }
  return vec4f(color,1.);
}
struct BulletOut { @builtin(position) position:vec4f, @location(0) local:vec2f, @location(1) color:vec3f, @location(2) alpha:f32 };
@vertex fn bullet_vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->BulletOut {
  let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let bullet=bullets[instance]; let local=corners[vertex];
  let screen=(bullet.xy-view.camera+local*select(4.,2.+bullet.w*4.,instance>=256u))/(view.size*.5);
  var out:BulletOut;
  out.position=vec4f(screen.x,-screen.y,0.,1.);
  if(bullet.w<=0.){out.position=vec4f(2.,2.,0.,1.);}
  out.local=local;out.color=tint(u32(bullet.z));out.alpha=bullet.w;return out;
}
@fragment fn bullet_fs(in:BulletOut)->@location(0) vec4f {
  return vec4f(in.color,in.alpha*exp(-dot(in.local,in.local)*4.));
}
