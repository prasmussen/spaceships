struct View { size: vec2f, camera: vec2f, mode:f32, time:f32, motion:f32, padding:f32 };
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
fn exhaust(p:vec2f,power:f32,player:u32)->vec3f {
  if(power<.01 || p.y<10. || p.y>34. || abs(p.x)>9.){return vec3f(0.);}
  let t=view.time+f32(player)*2.7;
  let pulse=(sin(t*27.)*.55+sin(t*43.+1.3)*.3+sin(t*71.)*.15)*view.motion;
  let length=12.+power*9.+pulse*.8;
  let y=p.y-10.;let progress=clamp(y/length,0.,1.);
  // Keep the original short triangular silhouette, with a gently moving edge.
  let bend=(sin(y*.38-t*24.)+sin(y*.73-t*37.)*.4)*progress*.3*view.motion;
  let x=abs(p.x-bend);
  let width=4.6*(1.-progress)*(1.+sin(y*.7-t*31.)*.04*view.motion);
  let tip=1.-smoothstep(length-2.,length,y);
  let ignition=smoothstep(0.,.6,y)*power;
  let plume=(1.-smoothstep(max(0.,width-.65),width+.35,x))*tip;
  let core=exp(-pow(x/max(width*.45,.2),2.)*2.)*(1.-smoothstep(4.,length*.62,y));
  let glow=exp(-x*x/20.)*exp(-y/10.)*.12;
  let diamonds=.8+.2*pow(sin(y*.52-t*7.*view.motion),2.);
  let flame=mix(vec3f(.25,.65,1.),vec3f(1.,.28,.035),smoothstep(.13,.72,progress));
  return (flame*plume*diamonds+vec3f(.7,.9,1.)*core*1.7+vec3f(.18,.42,.8)*glow)*ignition;
}
@fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f {
  let world=pos.xy-view.size*.5+view.camera;
  let grid=abs(fract(world/100.+.5)-.5)*100.;
  var color=vec3f(.025,.044,.062);
  if(min(grid.x,grid.y)<.7){color+=vec3f(.025,.044,.05);}
  if(view.mode>.5) {
    let solidCount=select(arrayLength(&terrain)-2u,6u,view.mode>1.5);
    for(var i=0u;i<solidCount;i++) {
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
    color+=exhaust(p,ship.thrust,player);
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
struct Fragment { position:vec2f, angle:f32, size:f32, player:f32, alpha:f32, shade:f32, strip:f32, vertices:array<vec2f,4> };
@group(0) @binding(4) var<storage,read> fragments:array<Fragment>;
struct FragmentOut { @builtin(position) position:vec4f, @location(0) color:vec3f, @location(1) alpha:f32, @location(2) local:vec2f, @location(3) @interpolate(flat) shape:u32 };
@vertex fn fragment_vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->FragmentOut {
  let piece=fragments[instance];
  let indices=array<u32,6>(0u,1u,2u,0u,2u,3u);
  let local=piece.vertices[indices[vertex]];
  let uv=array<vec2f,4>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(1,1));
  let c=cos(piece.angle);let s=sin(piece.angle);
  let rotated=vec2f(c*local.x-s*local.y,s*local.x+c*local.y);
  let screen=(piece.position-view.camera+rotated)/(view.size*.5);
  var out:FragmentOut;out.position=vec4f(screen.x,-screen.y,0.,1.);
  out.local=uv[indices[vertex]];out.shape=u32(piece.strip);
  // Painted plates and bright cut edges stay readable as solid ship parts.
  let metal=mix(vec3f(.22,.28,.31),vec3f(.65,.72,.74),piece.shade);
  out.color=mix(metal,tint(u32(piece.player)),select(.75,.95,piece.strip>.5));
  out.color*=.75+.25*abs(cos(piece.angle));out.alpha=piece.alpha;return out;
}
@fragment fn fragment_fs(in:FragmentOut)->@location(0) vec4f {
  let bary=vec3f(in.local,1.-in.local.x-in.local.y);
  let edge=min(min(bary.x/max(fwidth(bary.x),.001),bary.y/max(fwidth(bary.y),.001)),bary.z/max(fwidth(bary.z),.001));
  let rim=select(1.-smoothstep(.0,.85,edge),.6,in.shape==1u);
  return vec4f(mix(in.color,vec3f(.8,.94,.95),rim*.6),in.alpha);
}
