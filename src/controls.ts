const defaults=['KeyW','KeyA','KeyD','Space','ShiftLeft'];
const arrows=['ArrowUp','ArrowLeft','ArrowRight'];
const actions=['Thrust','Rotate left','Rotate right','Fire','Boost'];
const supported=/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|ShiftLeft|ShiftRight)$/;
function label(code:string){return code.replace(/^Key|^Digit/,'').replace('Arrow','').replace('ShiftLeft','Left Shift').replace('ShiftRight','Right Shift');}
export class Controls {
  private codes=[...defaults];
  reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  sound=true;
  private pending=-1;
  private dialog=document.createElement('dialog');
  private output=document.createElement('output');
  private buttons:HTMLButtonElement[]=[];
  constructor(clear:()=>void){
    try{let saved=JSON.parse(localStorage.getItem('cavern-controls-v2')??localStorage.getItem('cavern-controls')??'null');if(!localStorage.getItem('cavern-controls-v2')&&Array.isArray(saved)){saved=saved.slice(0,4);saved.push(['ShiftLeft','ShiftRight','Enter'].find(c=>!saved.includes(c)));}if(Array.isArray(saved)&&saved.length===5&&saved.every(c=>typeof c==='string'&&supported.test(c))&&new Set(saved).size===5){this.codes=saved;localStorage.setItem('cavern-controls-v2',JSON.stringify(saved));}}catch{}
    try{const value=localStorage.getItem('cavern-reduced-motion');if(value==='true'||value==='false')this.reducedMotion=value==='true';}catch{}
    try{this.sound=localStorage.getItem('cavern-sound')!=='false';}catch{}
    this.dialog.id='controls-panel';this.dialog.setAttribute('aria-labelledby','controls-title');
    const title=document.createElement('h2');title.id='controls-title';title.textContent='Controls';
    const intro=document.createElement('p');intro.textContent='Select an action, then press a key. Escape cancels. Each action needs a different key. Up also thrusts; Left and Right also rotate, unless assigned to another action. These controls apply to your ship in practice and online matches.';
    this.dialog.append(title,intro);
    const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Your ship';group.append(legend);
    for(let a=0;a<5;a++)group.append(this.binding(a,actions[a],actions[a]));
    this.dialog.append(group);
    const motionLabel=document.createElement('label'),motion=document.createElement('input');motion.type='checkbox';motion.checked=this.reducedMotion;motionLabel.append(motion,' Reduce camera motion');this.dialog.append(motionLabel);
    motion.onchange=()=>{this.reducedMotion=motion.checked;try{localStorage.setItem('cavern-reduced-motion',String(motion.checked));}catch{}clear();};
    const soundLabel=document.createElement('label'),sound=document.createElement('input');sound.type='checkbox';sound.checked=this.sound;soundLabel.append(sound,' Sound effects');this.dialog.append(soundLabel);
    sound.onchange=()=>{this.sound=sound.checked;try{localStorage.setItem('cavern-sound',String(sound.checked));}catch{}};
    this.output.setAttribute('aria-live','polite');this.dialog.append(this.output);
    const reset=document.createElement('button');reset.textContent='Restore default controls';reset.onclick=()=>{this.codes=[...defaults];this.pending=-1;this.save();};
    const close=document.createElement('button');close.textContent='Done';close.onclick=()=>this.dialog.close();this.dialog.append(reset,close);
    this.dialog.onclose=()=>{this.pending=-1;this.refresh();clear();};
    this.dialog.addEventListener('keydown',e=>{
      if(this.pending<0)return;
      if(e.code==='Escape'){e.preventDefault();this.pending=-1;this.output.textContent='Binding cancelled.';this.refresh();return;}
      if(e.code==='Tab')return;
      e.preventDefault();e.stopPropagation();
      if(e.repeat)return;
      if(e.ctrlKey||e.altKey||e.metaKey||!supported.test(e.code)){this.output.textContent='Use a letter, number, arrow, Space, Enter or Shift.';return;}
      const conflict=this.codes.indexOf(e.code);
      if(conflict>=0&&conflict!==this.pending){this.output.textContent=`${label(e.code)} is already assigned. Choose another key.`;return;}
      this.codes[this.pending]=e.code;this.pending=-1;this.save();clear();
    });
    document.body.append(this.dialog);
    document.querySelector('#controls-open')!.addEventListener('click',()=>{clear();this.output.textContent='';this.dialog.showModal();});
    this.refresh();
  }
  get open(){return this.dialog.open;}
  lookup(code:string):number {
    const i=this.codes.indexOf(code);
    if(i>=0)return 1<<i;
    const arrow=arrows.indexOf(code);return arrow>=0?1<<arrow:0;
  }
  private binding(index:number,name:string,text:string){
    const row=document.createElement('div'),caption=document.createElement('span'),button=document.createElement('button');caption.textContent=text;
    button.setAttribute('aria-label',name);button.onclick=()=>{this.pending=index;this.output.textContent=`Press a key for ${name}.`;this.refresh();};
    this.buttons[index]=button;row.append(caption,button);return row;
  }
  private save(){this.output.textContent='Controls saved.';try{localStorage.setItem('cavern-controls-v2',JSON.stringify(this.codes));}catch{this.output.textContent='Controls applied for this visit; browser storage is unavailable.';}this.refresh();}
  private refresh(){
    this.buttons.forEach((button,i)=>{button.textContent=this.pending===i?'Press a key…':label(this.codes[i]);button.setAttribute('aria-pressed',String(this.pending===i));});
    const footer=document.querySelector('footer')!;
    footer.replaceChildren();
    const line=document.createElement('span');line.textContent=actions.map((action,i)=>{
      const alias=arrows[i],keys=alias&&!this.codes.includes(alias)?`${label(this.codes[i])} / ${label(alias)}`:label(this.codes[i]);
      return `${keys} ${action.toLowerCase()}`;
    }).join(' · ');footer.append(line);
    const hint=document.createElement('p');hint.textContent='Boost bursts for 0.3s, uses extra fuel and recharges in 5s. Release before boosting again. Land upright and slowly on your illuminated pad to refuel.';footer.append(hint);
  }
}
