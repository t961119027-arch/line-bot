/* ================= index.js ================= */
require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const { google } = require("googleapis");
const app = express();
const REGISTER_CODE = "MH0928";
const activeSettlement = new Map();
const config = { channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN, channelSecret: process.env.CHANNEL_SECRET };
const client = new line.Client(config);
const auth = new google.auth.GoogleAuth({credentials:{client_email:process.env.GOOGLE_CLIENT_EMAIL,private_key:process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,'\n')},scopes:['https://www.googleapis.com/auth/spreadsheets']});
const sheets = google.sheets({version:'v4',auth});
const spreadsheetId = process.env.SPREADSHEET_ID;
async function getSheet(range){const r=await sheets.spreadsheets.values.get({spreadsheetId,range});return r.data.values||[];}
async function appendSheet(range,values){await sheets.spreadsheets.values.append({spreadsheetId,range,valueInputOption:'USER_ENTERED',requestBody:{values}})}
async function updateSheet(range,values){await sheets.spreadsheets.values.update({spreadsheetId,range,valueInputOption:'USER_ENTERED',requestBody:{values}})}
async function getUser(userId){const users=await getSheet('Users!A:C'); return {users,row:users.find(r=>r[0]===userId)};}
function flexCard(title, body, buttons=[]){return {type:'flex',altText:title,contents:{type:'bubble',body:{type:'box',layout:'vertical',contents:[{type:'text',text:title,weight:'bold',size:'xl'},{type:'separator',margin:'md'},{type:'text',text:body,wrap:true,margin:'md'}]},footer:buttons.length?{type:'box',layout:'vertical',spacing:'sm',contents:buttons.map(b=>({type:'button',style:'primary',action:{type:'message',label:b.label,text:b.text}}))}:undefined}}}
function reply(token,msg){return client.replyMessage(token,msg)}
function help(){return '可用功能：/功能 /menu /註冊 /結算 /價格表 /設定價格 /查詢 /管理總表 /取消\n智慧帳務：小明 -4500 / 小明 +2000';}
app.post('/webhook', line.middleware(config), async (req,res)=>{try{await Promise.all(req.body.events.map(handleEvent));res.status(200).end();}catch(e){console.error(e);res.status(500).end();}});
async function handleEvent(event){if(event.type!=='message'||event.message.type!=='text') return null; const msg=event.message.text.trim(); const userId=event.source.userId;
if(msg==='/menu'){return reply(event.replyToken, flexCard('工作室 ERP','快速操作',[{label:'功能',text:'/功能'},{label:'價格表',text:'/價格表'},{label:'管理總表',text:'/管理總表'}]));}
if(msg.startsWith('/註冊 ')){const p=msg.split(' '); if(p.length!==4)return reply(event.replyToken,{type:'text',text:'格式：/註冊 MH0928 名稱 admin|manager'}); if(p[1]!==REGISTER_CODE)return reply(event.replyToken,{type:'text',text:'註冊碼錯誤'}); if(!['admin','manager'].includes(p[3])) return reply(event.replyToken,{type:'text',text:'身份錯誤'}); const existing=await getUser(userId); if(existing.row)return reply(event.replyToken,{type:'text',text:'已註冊'}); await appendSheet('Users!A:C',[[userId,p[2],p[3]]]); return reply(event.replyToken,flexCard('註冊成功',`${p[2]} (${p[3]})`));}
if(msg==='/功能') return reply(event.replyToken, flexCard('功能說明', help()));
const {users,row:user}=await getUser(userId); if(!user) return reply(event.replyToken,{type:'text',text:'你沒有權限使用，請先註冊'}); const actor=user[1], role=user[2];
if(msg.startsWith('/removeadmin ')){ if(role!=='admin') return reply(event.replyToken,{type:'text',text:'無權限'}); const name=msg.replace('/removeadmin ','').trim(); let changed=false; const updated=users.map(r=>{ if(r[1]===name && r[2]==='admin'){changed=true; return [r[0],r[1],'manager'];} return r;}); if(changed){await updateSheet('Users!A:C',updated); return reply(event.replyToken,{type:'text',text:'權限已調整'});} return reply(event.replyToken,{type:'text',text:'找不到 admin'}); }
if(msg==='/價格表'){const pricing=await getSheet('Pricing!A:C'); return reply(event.replyToken, flexCard('價格表', pricing.map(r=>`${r[0]} ${r[1]} → ${r[2]}`).join('\n')||'無資料'));}
if(msg.startsWith('/設定價格 ')){ if(role!=='admin') return reply(event.replyToken,{type:'text',text:'只有 admin 可用'}); const p=msg.split(' '); await appendSheet('Pricing!A:C',[[p[1],Number(p[2]),Number(p[3])]]); return reply(event.replyToken, flexCard('價格設定完成',`${p[1]} ${p[2]} → ${p[3]}`));}
if(msg.startsWith('/結算 ')){activeSettlement.set(userId,msg.replace('/結算 ','').trim()); return reply(event.replyToken, flexCard('結算模式','請貼多筆\n1390 2900049\n750 2900050'));}
if(msg==='/取消'){activeSettlement.delete(userId); return reply(event.replyToken,{type:'text',text:'已取消'});}
if(msg==='/管理總表'){ if(role!=='admin') return reply(event.replyToken,{type:'text',text:'只有 admin 可用'}); const rows=await getSheet('Sheet1!A:G'); let rev=0,com=0; rows.slice(1).forEach(r=>{rev+=Number(r[3])||0; com+=Number(r[4])||0;}); return reply(event.replyToken, flexCard('管理總表',`總營收：${rev}\n總抽成：${com}`));}
if(msg.startsWith('/查詢 ')){const target=msg.replace('/查詢 ','').trim(); const ledger=await getSheet('Ledger!A:E'); let owed=0,you=0; ledger.forEach(r=>{const amt=Number(r[3])||0; if(r[1]===target&&r[2]===actor) owed+=amt; if(r[1]===actor&&r[2]===target) you+=amt;}); return reply(event.replyToken, flexCard(`與 ${target} 帳務`,`${target} 欠你：${owed}\n你欠對方：${you}\n淨額：${owed-you}`));}
if(activeSettlement.has(userId)){const employee=activeSettlement.get(userId); const pricing=await getSheet('Pricing!A:C'); const existing=new Set((await getSheet('Sheet1!G:G')).flat()); const lines=msg.split('\n').map(v=>v.trim()).filter(Boolean); let count=0,rev=0,com=0; const rows=[]; for(const line of lines){const [ps,oid]=line.split(/\s+/); const price=Number(ps); if(!price||!oid||existing.has(oid)) continue; const m=pricing.find(r=>Number(r[1])===price); if(!m) continue; const c=Number(m[2]); rows.push([new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}),employee,m[0],price,c,price-c,oid]); count++; rev+=price; com+=c;} if(rows.length) await appendSheet('Sheet1!A:G',rows); activeSettlement.delete(userId); return reply(event.replyToken, flexCard(`${employee} 結算完成`,`訂單：${count}\n總營收：${rev}\n總抽成：${com}`,[{label:'功能',text:'/功能'}]));}
const debt=msg.match(/^(.+?)\s+([+-])(\d+)(?:\s+(.+))?$/); if(debt){const target=debt[1].trim(), sign=debt[2], amt=Number(debt[3]), note=debt[4]||''; const debtor=sign==='-'?target:actor; const creditor=sign==='-'?actor:target; await appendSheet('Ledger!A:E',[[new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}),debtor,creditor,amt,note]]); return reply(event.replyToken, flexCard('帳務已記錄',`${debtor} 欠 ${creditor} ${amt}`));}
return reply(event.replyToken,{type:'text',text:help()}); }
const PORT=process.env.PORT||10000; app.listen(PORT,()=>console.log('ERP Bot V5 running'));
