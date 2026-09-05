// A DOM good enough to actually run this app's render + event code.
let idSeq = 0;
class El {
  constructor(tag='div'){
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
    this.attrs = {}; this.style = {}; this._html = ''; this.value = ''; this.files = [];
    this._listeners = {}; this.checked = false; this.disabled = false;
    this.classList = {
      _s:new Set(),
      add:(...c)=>c.forEach(x=>this.classList._s.add(x)),
      remove:(...c)=>c.forEach(x=>this.classList._s.delete(x)),
      toggle:(c,f)=>{ f===undefined ? (this.classList._s.has(c)?this.classList._s.delete(c):this.classList._s.add(c)) : (f?this.classList._s.add(c):this.classList._s.delete(c)); },
      contains:(c)=>this.classList._s.has(c)
    };
    this.id = 'el'+(++idSeq);
  }
  set innerHTML(v){ this._html = String(v); }
  get innerHTML(){ return this._html; }
  set textContent(v){ this._text = String(v); }
  get textContent(){ return this._text || ''; }
  setAttribute(k,v){ this.attrs[k]=String(v); }
  getAttribute(k){ return this.attrs[k] ?? null; }
  hasAttribute(k){ return k in this.attrs; }
  removeAttribute(k){ delete this.attrs[k]; }
  appendChild(c){ c.parentNode=this; this.children.push(c); return c; }
  removeChild(c){ this.children=this.children.filter(x=>x!==c); c.parentNode=null; return c; }
  addEventListener(t,f){ (this._listeners[t]=this._listeners[t]||[]).push(f); }
  removeEventListener(t,f){ if(this._listeners[t]) this._listeners[t]=this._listeners[t].filter(x=>x!==f); }
  dispatchEvent(ev){ (this._listeners[ev.type]||[]).forEach(f=>f(ev)); return true; }
  querySelector(){ return null; }
  querySelectorAll(){ return []; }
  closest(){ return null; }
  focus(){} blur(){} click(){} scrollIntoView(){}
  setPointerCapture(){} releasePointerCapture(){}
  getBoundingClientRect(){ return {left:0,top:0,width:300,height:200,right:300,bottom:200}; }
  getContext(){ return { measureText:()=>({width:10}), fillRect(){}, fillText(){}, drawImage(){}, clearRect(){}, beginPath(){}, arc(){}, fill(){}, stroke(){}, save(){}, restore(){}, translate(){}, rotate(){}, scale(){} }; }
  toDataURL(){ return 'data:image/jpeg;base64,AAAA'; }
  get clientWidth(){ return 300; } get clientHeight(){ return 200; }
  get naturalWidth(){ return 600; } get naturalHeight(){ return 400; }
  get complete(){ return true; }
}
const registry = {};
function el(id){ if(!registry[id]) { registry[id]=new El(); registry[id].id=id; } return registry[id]; }
globalThis.__domRegistry = registry;
globalThis.__El = El;
globalThis.document = {
  getElementById:(id)=>el(id),
  querySelector:()=>new El(),
  querySelectorAll:()=>[],
  createElement:(t)=>new El(t),
  addEventListener(t,f){ (this._l=this._l||{})[t]=(this._l[t]||[]).concat(f); },
  removeEventListener(){},
  body: new El('body'), head: new El('head'),
  activeElement: null, hidden: false
};
globalThis.window = {
  addEventListener(){}, removeEventListener(){}, devicePixelRatio:1,
  scrollTo(){}, location:{ reload(){}, href:'http://localhost/' }, __threePromise:undefined
};
globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]}, clear(){this._d={}} };
globalThis.AbortController = class { constructor(){ this.signal={aborted:false}; } abort(){ this.signal.aborted=true; } };
globalThis.Blob = class { constructor(p,o){ this.parts=p; this.type=(o&&o.type)||''; this.size=100; } };
globalThis.FileReader = class {
  readAsDataURL(){ setTimeout(()=>{ this.result='data:image/jpeg;base64,AAAA'; this.onload&&this.onload(); },0); }
  readAsArrayBuffer(){ setTimeout(()=>{ this.result=new ArrayBuffer(8); this.onload&&this.onload(); },0); }
};
globalThis.Image = class extends El { constructor(){ super('img'); setTimeout(()=>this.onload&&this.onload(),0); } };
globalThis.WebSocket = class { constructor(){ this.readyState=0; setTimeout(()=>{this.readyState=1; this.onopen&&this.onopen();},1);} send(){} close(){ this.readyState=3; this.onclose&&this.onclose(); } };
globalThis.requestAnimationFrame = (f)=>setTimeout(()=>f(Date.now()),0);
globalThis.cancelAnimationFrame = (id)=>clearTimeout(id);
globalThis.confirm = ()=>true;
globalThis.alert = ()=>{};
globalThis.btoa = (s)=>Buffer.from(s,'binary').toString('base64');
globalThis.atob = (s)=>Buffer.from(s,'base64').toString('binary');
