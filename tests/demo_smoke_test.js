const fs=require('fs'),vm=require('vm');const ids={};
class Node{constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.value='';this.classList={add(){},remove(){},toggle(){}};this.handlers={};this.dataset={};}addEventListener(type,fn){this.handlers[type]=fn;}get options(){return []}}
function get(id){return ids[id]||(ids[id]=new Node(id))}
for(const k of ['dashboard','transactions','wallets','budgets','goals','members','insights','settings','authScreen','appShell','sideNav','bottomNav','modeName','logoutSide','householdName','pageTitle','alertArea','toast','dialogTitle','dialogBody','dialogBackdrop','authForm','authSubmit','authPassword','authEmail','tabLogin','tabSignup','toDemo','refreshBtn','closeDialog'])get(k);
const listeners={};const storage=new Map();let interval;
const localStorage={setItem(k,v){storage.set(k,v)},getItem(k){return storage.get(k)||null},removeItem(k){storage.delete(k)}};
const ctx={window:{FM_CONFIG:{},crypto:{randomUUID:()=>'uuid-hello'}},document:{getElementById:get,querySelectorAll(sel){if(sel==='.page')return ['dashboard','transactions','wallets','budgets','goals','members','insights','settings'].map(get);return []},addEventListener:(e,cb)=>listeners[e]=cb},localStorage,setTimeout:(fn)=>{},setInterval:(fn)=>{interval=fn},clearTimeout:()=>{},navigator:{},location:{protocol:'file:'},console,Intl,Date,Math,JSON,Number,String,Array,Object,Map,RegExp,Error,Promise,FormData:class {constructor(form){this.form=form}entries(){return Object.entries(this.form.fields)}},confirm:()=>true,prompt:()=>null,Blob:class{},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},crypto:{randomUUID:()=>'uuid-hello'}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','app.js'),'utf8'),ctx);
if(!get('dashboard').innerHTML.includes('Tổng thu tháng'))throw Error('missing dashboard');
if(!get('householdName').innerHTML.includes('Gia đình mẫu'))throw Error('missing demo household');
const submit=(id,fields)=>listeners.submit({preventDefault(){},target:{id,fields}});
(async()=>{await submit('formWallet',{name:'Ví dự phòng',opening_balance:'100000',scope:'private'});const d=JSON.parse(localStorage.getItem('fm_demo_v2'));if(!d.wallets.some(w=>w.name==='Ví dự phòng'))throw Error('new wallet not persisted');
await submit('formTx',{type:'expense',amount:'60000',category:'Ăn uống',wallet_id:'wallet-1',tx_date:'2026-10-13',note:'Bữa sáng'});const dd=JSON.parse(localStorage.getItem('fm_demo_v2'));if(!dd.transactions.some(t=>t.note==='Bữa sáng'))throw Error('transaction not persisted');
console.log('PASS: dashboard, demo persistence, new wallet, transaction');})().catch(e=>{console.error(e);process.exit(1)});
