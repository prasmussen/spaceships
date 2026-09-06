const defaults=['KeyW','KeyA','KeyD','Space','ArrowUp','ArrowLeft','ArrowRight','Enter','KeyR'];
const actions=['Thrust','Rotate left','Rotate right','Fire'];
const supported=/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|ShiftLeft|ShiftRight)$/;
function label(code:string){return code.replace(/^Key|^Digit/,'').replace('Arrow','').replace('ShiftLeft','Left Shift').replace('ShiftRight','Right Shift');}
export class Controls {
  private codes=[...defaults];
  reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  sound=false;
  private pending=-1;
  private dialog=document.createElement('dialog');
  private output=document.createElement('output');
  private buttons:HTMLButtonElement[]=[];
  constructor(clear:()=>void){
    try{const saved=JSON.parse(localStorage.getItem('cavern-controls')??'null');if(Array.isArray(saved)&&saved.length===9&&saved.every(c=>typeof c==='string'&&supported.test(c))&&new Set(saved).size===9)this.codes=saved;}catch{}
    try{const value=localStorage.getItem('cavern-reduced-motion');if(value==='true'||value==='false')this.reducedMotion=value==='true';}catch{}
    try{this.sound=localStorage.getItem('cavern-sound')==='true';}catch{}
    this.dialog.id='controls-panel';this.dialog.setAttribute('aria-labelledby','controls-title');
    const title=document.createElement('h2');title.id='controls-title';title.textContent='Controls';
    const intro=document.createElement('p');intro.textContent='Select an action, then press a key. Escape cancels. Each action needs a different key. Online play accepts either player’s controls.';
    this.dialog.append(title,intro);
    for(let player=0;player<2;player++){
      const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=`Player ${player+1}`;group.append(legend);
      for(let a=0;a<4;a++)group.append(this.binding(player*4+a,`Player ${player+1} ${actions[a]}`,actions[a]));
      this.dialog.append(group);
    }
    this.dialog.append(this.binding(8,'Restart or rematch','Restart / rematch'));
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
  lookup(code:string):[number,number]|undefined {const i=this.codes.indexOf(code);return i>=0&&i<8?[Math.floor(i/4),1<<(i%4)]:undefined;}
  restart(code:string){return code===this.codes[8];}
  private binding(index:number,name:string,text:string){
    const row=document.createElement('div'),caption=document.createElement('span'),button=document.createElement('button');caption.textContent=text;
    button.setAttribute('aria-label',name);button.onclick=()=>{this.pending=index;this.output.textContent=`Press a key for ${name}.`;this.refresh();};
    this.buttons[index]=button;row.append(caption,button);return row;
  }
  private save(){this.output.textContent='Controls saved.';try{localStorage.setItem('cavern-controls',JSON.stringify(this.codes));}catch{this.output.textContent='Controls applied for this visit; browser storage is unavailable.';}this.refresh();}
  private refresh(){
    this.buttons.forEach((button,i)=>{button.textContent=this.pending===i?'Press a key…':label(this.codes[i]);button.setAttribute('aria-pressed',String(this.pending===i));});
    const footer=document.querySelector('footer')!;
    footer.replaceChildren();
    for(let p=0;p<2;p++){const line=document.createElement('span');if(p)line.className='p2-controls';line.textContent=`P${p+1}: ${actions.map((action,i)=>`${label(this.codes[p*4+i])} ${action.toLowerCase()}`).join(' · ')}`;footer.append(line);}
    const restart=document.createElement('p');restart.textContent=`${label(this.codes[8])} restart / rematch · Land upright and slowly on your illuminated pad to refuel.`;footer.append(restart);
  }
}
