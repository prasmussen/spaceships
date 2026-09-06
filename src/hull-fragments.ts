type Point=[number,number];
type Triangle=[Point,Point,Point];
const nose:Point=[0,-17],left:Point=[-12,12],tail:Point=[0,7],right:Point=[12,12];
const plates:Triangle[]=[[nose,left,tail],[nose,tail,right]];
const area=([a,b,c]:Triangle)=>Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
// Cut the actual hull into plates, retaining its pointed nose and wing tips.
while(plates.length<8){
  const index=plates.reduce((best,t,i)=>area(t)>area(plates[best])?i:best,0);
  const triangle=plates[index];
  const edge=triangle.reduce((best,a,i)=>{
    const length=(k:number)=>Math.hypot(triangle[k][0]-triangle[(k+1)%3][0],triangle[k][1]-triangle[(k+1)%3][1]);
    return length(i)>length(best)?i:best;
  },0);
  const a=triangle[edge],b=triangle[(edge+1)%3],c=triangle[(edge+2)%3],mid:Point=[(a[0]+b[0])/2,(a[1]+b[1])/2];
  plates.splice(index,1,[a,mid,c],[mid,b,c]);
}
const shapes:Point[][]=[...plates];
const outline=[nose,left,tail,right];
for(let edge=0;edge<4;edge++){
  const a=outline[edge],b=outline[(edge+1)%4],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  const nx=-dy/length*.6,ny=dx/length*.6;
  for(let i=0;i<2;i++){
    const x=a[0]+dx*i/2,y=a[1]+dy*i/2,ex=a[0]+dx*(i+1)/2,ey=a[1]+dy*(i+1)/2;
    shapes.push([[x+nx,y+ny],[ex+nx,ey+ny],[ex-nx,ey-ny],[x-nx,y-ny]]);
  }
}
export const HULL_FRAGMENTS=shapes.map((points,index)=>{
  const x=points.reduce((sum,p)=>sum+p[0],0)/points.length,y=points.reduce((sum,p)=>sum+p[1],0)/points.length;
  const vertices=points.map(p=>[p[0]-x,p[1]-y]);
  const size=Math.max(...vertices.map(p=>Math.hypot(...p)));
  if(vertices.length===3)vertices.push(vertices[2]);
  return {x,y,size,vertices:vertices.flat(),strip:index>=8};
});
