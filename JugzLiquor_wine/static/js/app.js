/* ═══════════════════════════════════════════════════
   app.js — LiquorKiosk (Alex AI Sommelier)
═══════════════════════════════════════════════════ */

let currentScreen = 'home', chatHistory = [], isThinking = false;
let isSpeaking = false, isListening = false, recognition = null;
let currentProduct = null, catalogMode = 'products', catFilter = '';
let allProducts = [], allRecipes = [];
let slideIndex = 0, slideTimer = null;

const SYSTEM = ''; /* System prompt is now built server-side with real inventory data */

/* ── Screen nav ── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active','exit');
    s.classList.add('exit');
    setTimeout(() => s.classList.remove('exit'), 440);
  });
  setTimeout(() => {
    const el = document.getElementById(id);
    el.classList.remove('exit');
    el.classList.add('active');
  }, 55);
  currentScreen = id;
}
function goHome() { stopSpeak(); showScreen('screen-home'); startSlides(); }
function goAlex(cat) {
  showScreen('screen-alex'); stopSlides();
  if (cat) setTimeout(() => selectCat(cat), 360);
}
function goSearch() { loadCatalog('products'); showScreen('screen-catalog'); }

/* ── Slideshow ── */
function startSlides() { slideTimer = setInterval(nextSlide, 7200); }
function stopSlides() { clearInterval(slideTimer); }
function goSlide(n) {
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.sdot');
  slides[slideIndex].classList.remove('active');
  dots[slideIndex].classList.remove('active');
  slideIndex = ((n % slides.length) + slides.length) % slides.length;
  slides[slideIndex].classList.add('active');
  dots[slideIndex].classList.add('active');

  /* Crossfade background photos in sync with slides */
  const bgIdx = slides[slideIndex].getAttribute('data-bg');
  if (bgIdx !== null) {
    document.querySelectorAll('.bg-photo').forEach(p => p.classList.remove('bg-active'));
    const target = document.getElementById('bgPhoto' + bgIdx);
    if (target) target.classList.add('bg-active');
  }
}
function nextSlide() { goSlide(slideIndex + 1); }
function prevSlide() { goSlide(slideIndex - 1); }

/* ── Clock ── */
function tick() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
setInterval(tick, 1000); tick();

/* ── Voice state ── */
function setVS(s) {
  const d = document.getElementById('voiceDot'), l = document.getElementById('voiceLabel');
  if (d) d.className = 'stat-dot ' + s;
  if (l) l.textContent = {idle:'Ready',listening:'Listening…',thinking:'Thinking…',speaking:'Speaking'}[s]||'Ready';
}

/* ── TTS ── */
const synth = window.speechSynthesis || null;
let alexVoice = null;
const FEMALE = ['Google UK English Female','Google US English Female','Microsoft Aria Online (Natural) - English (United States)','Microsoft Jenny Online (Natural) - English (United States)','Microsoft Sonia Online (Natural) - English (United Kingdom)','Microsoft Zira - English (United States)','Samantha','Karen','Moira','Tessa','Victoria'];

function loadVoices() {
  if (!synth || typeof synth.getAvailableVoices !== 'function') return;
  const vv = synth.getAvailableVoices();
  for (const n of FEMALE) { const v = vv.find(v=>v.name===n); if(v){alexVoice=v;break;} }
  if (!alexVoice) alexVoice = vv.find(v=>/female|woman|aria|jenny|sonia|zira|samantha|karen/i.test(v.name)) || vv.find(v=>v.lang?.startsWith('en')) || vv[0] || null;
  if (alexVoice) console.log('Voice:', alexVoice.name);
}
if (synth) {
  if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;
  loadVoices(); setTimeout(loadVoices, 400); setTimeout(loadVoices, 1500);
}

function speak(text) {
  if (!text || !synth) return;
  synth.cancel();
  const clean = text.replace(/\*\*/g,'').replace(/\*/g,'').replace(/#/g,'').replace(/\$/g,' dollars ').replace(/\n/g,', ').replace(/—/g,', ').trim();
  const utt = new SpeechSynthesisUtterance(clean);
  utt.voice = alexVoice; utt.rate = 1.04; utt.pitch = 1.2; utt.volume = 1;
  utt.onstart = () => { isSpeaking=true; setVS('speaking'); setAvatarTalking(true); document.getElementById('rings')?.classList.add('speaking'); };
  utt.onend = utt.onerror = () => { isSpeaking=false; setVS('idle'); setAvatarTalking(false); document.getElementById('rings')?.classList.remove('speaking');
    /* Continuous mode: auto-listen after AI finishes speaking */
    if(continuousMode && currentScreen==='screen-alex' && !isListening && !isThinking) {
      setTimeout(() => {
        if(!isListening && !isSpeaking && !isThinking) {
          if(!recognition) recognition = initSTT();
          if(recognition) try { recognition.start(); } catch(e) { recognition=initSTT(); if(recognition) try { recognition.start(); } catch(e2){ startWakeListener(); } }
        }
      }, 800);
    }
  };
  synth.speak(utt);
}
function stopSpeak() {
  if (synth) synth.cancel();
  isSpeaking=false; setVS('idle'); setAvatarTalking(false);
  document.getElementById('rings')?.classList.remove('speaking');
}

/* ── STT ── */
let continuousMode = false; /* When ON, auto-restarts listening after AI speaks */
let wakeListening = false;  /* Background wake word listener active */
let wakeRecognition = null; /* Separate recognition for wake word */

function initSTT() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR(); r.lang='en-US'; r.interimResults=true; r.continuous=false;
  r.onstart = () => { isListening=true; setVS('listening'); document.getElementById('micBtn')?.classList.add('active'); document.getElementById('transcriptBar')?.classList.add('show'); document.getElementById('transcriptText').textContent='Listening…'; setAvatarListening(true); stopSpeak(); };
  r.onresult = e => { let fin='',int=''; for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)fin+=e.results[i][0].transcript;else int+=e.results[i][0].transcript;} document.getElementById('transcriptText').textContent=(fin||int)||'Listening…'; if(fin)document.getElementById('chatInput').value=fin; };
  r.onend = () => { isListening=false; setAvatarListening(false); document.getElementById('micBtn')?.classList.remove('active'); document.getElementById('transcriptBar')?.classList.remove('show'); const v=document.getElementById('chatInput')?.value.trim(); if(v)setTimeout(()=>sendMessage(),360); if(!isSpeaking)setVS('idle'); };
  r.onerror = e => { isListening=false; setAvatarListening(false); document.getElementById('micBtn')?.classList.remove('active'); document.getElementById('transcriptBar')?.classList.remove('show'); if(e.error==='not-allowed')showToast('Microphone denied. Allow it in browser settings.'); else if(e.error!=='no-speech'&&e.error!=='aborted')showToast('Voice needs Chrome or Edge.'); if(!isSpeaking)setVS('idle');
    /* Restart wake word listener if continuous mode is on */
    if(continuousMode && !isListening) setTimeout(()=>startWakeListener(), 500);
  };
  return r;
}

/* Wake word ("Hey Alex") background listener */
function initWakeListener() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR(); r.lang='en-US'; r.interimResults=true; r.continuous=true;
  r.onresult = e => {
    for(let i=e.resultIndex;i<e.results.length;i++){
      const t = e.results[i][0].transcript.toLowerCase();
      if(t.includes('hey alex') || t.includes('hey alec') || t.includes('hey lex') || t.includes('hey allax') || t.includes('a alex')) {
        console.log('Wake word detected:', t);
        r.stop(); wakeListening=false;
        /* Wave and greet */
        if(typeof triggerWave === 'function') triggerWave(2500);
        if(typeof setBubble === 'function') setBubble("Hey! I'm listening — go ahead!", 'happy');
        /* Short delay then start active listening */
        setTimeout(() => {
          if(!isListening && !isThinking && !isSpeaking && currentScreen==='screen-alex') {
            if(!recognition) recognition = initSTT();
            if(recognition) try { recognition.start(); } catch(e) { recognition=initSTT(); if(recognition) recognition.start(); }
          }
        }, 300);
        return;
      }
    }
  };
  r.onend = () => { wakeListening=false;
    /* Auto-restart wake listener if continuous mode is still on and not actively listening */
    if(continuousMode && !isListening && !isSpeaking && !isThinking) setTimeout(()=>startWakeListener(), 800);
  };
  r.onerror = e => { wakeListening=false;
    if(e.error !== 'aborted' && e.error !== 'no-speech' && continuousMode) setTimeout(()=>startWakeListener(), 1500);
  };
  return r;
}

function startWakeListener() {
  if(wakeListening || isListening || isSpeaking || isThinking) return;
  if(!wakeRecognition) wakeRecognition = initWakeListener();
  if(!wakeRecognition) return;
  try { wakeRecognition.start(); wakeListening=true; } catch(e) { wakeRecognition=initWakeListener(); if(wakeRecognition) try { wakeRecognition.start(); wakeListening=true; } catch(e2){} }
}

function stopWakeListener() {
  if(wakeRecognition) try { wakeRecognition.stop(); } catch(e){}
  wakeListening=false;
}

function toggleContinuousMode() {
  continuousMode = !continuousMode;
  const btn = document.getElementById('continuousBtn');
  if(btn) {
    btn.classList.toggle('active', continuousMode);
    btn.title = continuousMode ? 'Continuous Listening ON' : 'Continuous Listening OFF';
  }
  if(continuousMode) {
    showToast('Continuous listening ON — say "Hey Alex" anytime');
    if(currentScreen==='screen-alex') startWakeListener();
  } else {
    showToast('Continuous listening OFF');
    stopWakeListener();
  }
}

function toggleMic() {
  if (!recognition) recognition = initSTT();
  if (!recognition) { showToast('Voice not supported. Use Chrome or Edge.'); return; }
  if (isListening) { recognition.stop(); } else { stopWakeListener(); try { recognition.start(); } catch(e) { recognition=initSTT(); if(recognition)recognition.start(); } }
}

/* ── Chat ── */
function addMsg(role, text) {
  const c = document.getElementById('messages');
  const d = document.createElement('div');
  d.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-alex');
  d.innerHTML = `<div class="msg-av">${role==='user'?'👤':'A'}</div><div class="msg-body">${esc(text)}</div>`;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
  chatHistory.push({ role: role==='user'?'user':'assistant', content: text });
}

function setBubble(text, emo) {
  const bt = document.getElementById('bubbleText'), td = document.getElementById('typingDots');
  if (td) td.classList.remove('show');
  if (bt) { bt.style.display=''; bt.textContent = text.length>120 ? text.slice(0,118)+'…' : text; }
  if (emo) setEmotion(emo);
}
function showTyping() {
  const bt=document.getElementById('bubbleText'), td=document.getElementById('typingDots');
  if(bt)bt.style.display='none'; if(td)td.classList.add('show'); setVS('thinking'); setEmotion('thinking');
}
function hideTyping() {
  const bt=document.getElementById('bubbleText'), td=document.getElementById('typingDots');
  if(bt)bt.style.display=''; if(td)td.classList.remove('show');
}

function detEmo(t) {
  const m = t.toLowerCase();
  if(/great choice|love this|excellent|fantastic|wonderful/.test(m)) return 'excited';
  if(/hmm|depends|actually|interesting/.test(m)) return 'thinking';
  if(/incredible|outstanding|you'll love|one of the/.test(m)) return 'surprised';
  if(/pro tip|fun fact|between you and me|secret/.test(m)) return 'cool';
  return 'happy';
}

async function sendMessage() {
  const inp = document.getElementById('chatInput');
  const text = inp?.value.trim();
  if (!text || isThinking) return;
  inp.value = '';
  addMsg('user', text); showTyping(); isThinking = true; stopSpeak();
  const msgs = chatHistory.slice(-16);
  try {
    const res = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({system:SYSTEM, messages:msgs}) });
    const data = await res.json();
    const reply = data.reply || offlineReply(text);
    const emo = detEmo(reply);
    hideTyping(); addMsg('assistant', reply); setBubble(reply, emo); setVS('idle'); isThinking=false;
    setTimeout(() => speak(reply), 180);
  } catch(e) {
    const reply = offlineReply(text); const emo = detEmo(reply);
    hideTyping(); addMsg('assistant', reply); setBubble(reply, emo); setVS('idle'); isThinking=false;
    setTimeout(() => speak(reply), 180);
  }
}

function offlineReply(q) {
  const m = q.toLowerCase();
  if(/bourbon|whiskey|whisky/.test(m)) return "Oh great taste! I love Blanton's Single Barrel — incredibly smooth with vanilla and caramel notes. Are you looking to sip it straight, mix cocktails, or is this for a gift?";
  if(/tequila/.test(m)) return "Tequila — excellent choice! Don Julio 1942 is silky smooth with caramel and vanilla — pure celebration in a bottle. For cocktails, Fortaleza Blanco makes the most incredible margarita. Which way are you leaning?";
  if(/gin/.test(m)) return "I love gin! Hendrick's has this beautiful cucumber and rose flavor that's completely unique. If you want something more complex, Monkey 47 with its 47 botanicals is extraordinary.";
  if(/vodka/.test(m)) return "For vodka, Grey Goose is incredibly clean and smooth. Tito's Handmade is also exceptional — Texas corn vodka that rivals anything in the store. Mixing or sipping?";
  if(/wine/.test(m)) return "Wine is a beautiful world! Caymus Cabernet from Napa is a crowd favorite — dense blackberry and chocolate. For sparkling, Moët Brut is always perfect. Red or white today?";
  if(/rum/.test(m)) return "Rum is so underrated! Diplomatico Reserva Exclusiva from Venezuela is world-class — dark toffee, fig, and butterscotch. For cocktails, Bacardi Superior makes a perfect mojito.";
  if(/margarita/.test(m)) return "Classic Margarita: two ounces blanco tequila, one ounce fresh lime juice, three-quarter ounce Cointreau. Shake hard with ice, strain into a salted rim glass. Fresh lime only — bottled juice ruins it!";
  if(/old fashioned/.test(m)) return "The Old Fashioned is the original cocktail. Two ounces bourbon, a sugar cube muddled with two dashes Angostura bitters, stir over a big ice cube for thirty seconds, then express an orange peel over the top.";
  if(/gift/.test(m)) return "Wonderful! Our Whiskey Lover's Set — Blanton's plus crystal glasses — is our most popular gift choice. Who's the lucky recipient?";
  return "I love your curiosity! I can help you find the perfect bottle, explain any spirit, or walk you through cocktail recipes. What would you like to explore?";
}

function handleKey(e) { if (e.key === 'Enter') sendMessage(); }

/* ── Category selection ── */
const CHIPS = {
  find:[
    {l:'🥃 Best Whiskey',q:"What are your best whiskey and bourbon recommendations?"},
    {l:'🌵 Premium Tequila',q:"Tell me about your top tequila selection"},
    {l:'🍷 Wine Guide',q:"Help me choose a great wine"},
    {l:'🌿 Craft Gin',q:"What are your top gin picks?"},
    {l:'🍸 Best Vodka',q:"Which vodkas do you recommend?"},
    {l:'🎁 Gift Ideas',q:"What are the best gift ideas?"},
    {l:'💎 Rare Bottles',q:"Tell me about rare and allocated bottles"},
    {l:'📋 Browse All',action:'catalog'},
  ],
  learn:[
    {l:'🥃 Bourbon vs Scotch',q:"What's the difference between bourbon and Scotch?"},
    {l:'🌵 Tequila Types',q:"Explain blanco, reposado and añejo tequila"},
    {l:'👃 Tasting Spirits',q:"How do I develop my palate and taste spirits properly?"},
    {l:'🍷 Wine Regions',q:"Walk me through the major wine regions of the world"},
    {l:'🍽️ Food Pairings',q:"What are the best food and spirit pairings?"},
    {l:'🔬 Distillation',q:"How does whiskey distillation and aging work?"},
    {l:'💎 Collecting',q:"Tell me about collecting rare and allocated spirits"},
  ],
  recipes:[
    {l:'🍋 Margarita',q:"Give me the perfect margarita recipe"},
    {l:'🥃 Old Fashioned',q:"How do I make a perfect Old Fashioned?"},
    {l:'🌹 Negroni',q:"Give me the Negroni recipe"},
    {l:'🥚 Whiskey Sour',q:"How do I make a whiskey sour with egg white foam?"},
    {l:'☕ Espresso Martini',q:"How do I make an espresso martini?"},
    {l:'🍊 Aperol Spritz',q:"What's the proper Aperol Spritz recipe?"},
    {l:'✈️ Paper Plane',q:"What is the Paper Plane cocktail?"},
    {l:'🔥 Penicillin',q:"How do I make the Penicillin cocktail?"},
    {l:'📋 All Recipes',action:'recipes'},
  ]
};
const CAT_INTRO = {
  find:"Oh great, let's find you something amazing! We carry a curated selection of the world's finest spirits. Browse below or just tell me what you're in the mood for.",
  learn:"Welcome to Liquor University! Whether you're just starting out or want to deep-dive on a specific spirit, I've got everything covered.",
  recipes:"Let's mix something incredible! I know everything from Prohibition-era classics to modern craft cocktails. Pick one or just ask me anything."
};

function selectCat(type) {
  document.querySelectorAll('.cat-card').forEach(c=>c.classList.remove('selected'));
  const card = document.getElementById('cat-' + type);
  if (card) card.classList.add('selected');
  const intro = CAT_INTRO[type];
  if (intro) { showTyping(); setTimeout(()=>{ hideTyping(); addMsg('assistant',intro); setBubble(intro,detEmo(intro)); setVS('idle'); speak(intro); },420); }
  const chips = document.getElementById('chips'); chips.innerHTML = '';
  (CHIPS[type]||[]).forEach(chip => {
    const btn = document.createElement('button'); btn.className='chip'; btn.textContent=chip.l;
    if (chip.action) { btn.onclick=()=>{ if(chip.action==='catalog')loadCatalog('products'); else if(chip.action==='recipes')loadCatalog('recipes'); showScreen('screen-catalog'); }; }
    else { btn.onclick=()=>{ document.getElementById('chatInput').value=chip.q; sendMessage(); }; }
    chips.appendChild(btn);
  });
}

/* ── Catalog ── */
async function loadCatalog(mode) {
  catalogMode = mode; catFilter = '';
  const title = document.getElementById('catalogTitle');
  const filter = document.getElementById('catalogFilter');
  if (mode === 'recipes') {
    if(title)title.textContent='🍹 Cocktail Recipes';
    if(filter)filter.style.display='none';
    await loadRecipes();
  } else {
    if(title)title.textContent='🍾 Product Catalog';
    if(filter)filter.style.display='flex';
    await loadProducts();
  }
}
async function loadProducts(f='',q='') {
  try {
    let url='/api/products';
    const p=new URLSearchParams(); if(f)p.set('category',f); if(q)p.set('q',q); if(p.toString())url+='?'+p;
    const res=await fetch(url); allProducts=await res.json(); renderProducts(allProducts);
  } catch(e){console.error(e);}
}
async function loadRecipes() {
  try { const res=await fetch('/api/recipes'); allRecipes=await res.json(); renderRecipes(allRecipes); } catch(e){}
}
function renderProducts(prods) {
  const g=document.getElementById('catalogGrid');
  if(!g)return;
  if(!prods.length){g.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:3rem;color:rgba(245,237,216,.4)">No products found.</div>';return;}
  g.innerHTML=prods.map(p=>{
    let priceHtml = '';
    if (p.sale_price) priceHtml = `<div class="pc-price"><span style="color:#4ade80;font-weight:600">$${Number(p.sale_price).toFixed(2)}</span> <span style="text-decoration:line-through;opacity:.5;font-size:11px">$${Number(p.price).toFixed(2)}</span></div>`;
    else if (p.price) priceHtml = `<div class="pc-price" style="color:var(--gold-l);font-weight:500">$${Number(p.price).toFixed(2)}</div>`;
    const stockHtml = p.in_stock===false ? '<span style="color:#ef4444;font-size:10px;margin-left:6px">OUT OF STOCK</span>' : '';
    const imgHtml = p.image_url ? `<img src="${esc(p.image_url)}" style="width:48px;height:48px;object-fit:contain;border-radius:6px;margin-bottom:4px" onerror="this.style.display='none'">` : `<div class="pc-icon">${p.icon}</div>`;
    return `<div class="pcard" onclick="showProduct('${p.id}')">${imgHtml}<div class="pc-name">${esc(p.name)}${stockHtml}</div>${priceHtml}<div class="pc-desc">${esc(p.desc)}</div><div class="pc-tags">${p.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div></div>`;
  }).join('');
}
function renderRecipes(recs) {
  const g=document.getElementById('catalogGrid');
  if(!g)return;
  const icons=['🥃','🍋','🌹','🥚','🍊','☕','✈️','🔥'];
  const dc={Easy:'d-easy',Medium:'d-med',Advanced:'d-adv'};
  g.innerHTML=recs.map((r,i)=>`<div class="rcard" onclick="showRecipe(${i})"><div class="rc-icon">${icons[i]||'🍹'}</div><div class="rc-name">${esc(r.name)}</div><div class="rc-diff ${dc[r.difficulty]||'d-easy'}">${r.difficulty}</div><div style="font-size:11.5px;color:rgba(245,237,216,.55)">${r.ingredients.slice(0,3).map(x=>esc(x)).join(', ')}${r.ingredients.length>3?'…':''}</div></div>`).join('');
}
function filterCatalog() {
  const q=document.getElementById('catalogSearch')?.value.trim()||'';
  if(catalogMode==='products')loadProducts(catFilter,q);
}
function setCatFilter(cat,btn) {
  catFilter=cat; document.querySelectorAll('.fc').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); document.getElementById('catalogSearch').value=''; loadProducts(cat);
}

/* ── Modals ── */
function showProduct(id) {
  const p=allProducts.find(x=>String(x.id)===String(id)); if(!p)return; currentProduct=p;
  let priceHtml = '';
  if (p.sale_price) priceHtml = `<div style="margin:8px 0;font-size:18px"><span style="color:#4ade80;font-weight:700">$${Number(p.sale_price).toFixed(2)}</span> <span style="text-decoration:line-through;opacity:.4;font-size:14px">$${Number(p.price).toFixed(2)}</span> <span style="background:rgba(74,222,128,.15);color:#4ade80;padding:2px 8px;border-radius:4px;font-size:11px">SALE</span></div>`;
  else if (p.price) priceHtml = `<div style="margin:8px 0;font-size:18px;color:var(--gold-l);font-weight:600">$${Number(p.price).toFixed(2)}</div>`;
  const details = [p.brand, p.size, p.abv ? p.abv+'% ABV' : ''].filter(Boolean).join(' · ');
  const aisleHtml = p.aisle ? `<div style="margin:6px 0;font-size:12px;color:var(--tx2)">📍 ${esc(p.aisle)}</div>` : '';
  const modalImg = p.image_url ? `<img src="${esc(p.image_url)}" style="max-height:120px;object-fit:contain;border-radius:8px;margin-bottom:8px" onerror="this.style.display='none'">` : `<div class="m-icon">${p.icon}</div>`;
  document.getElementById('modalContent').innerHTML=`${modalImg}<div class="m-name">${esc(p.name)}</div><div class="m-cat">${esc(p.category)}${details ? ' · '+esc(details) : ''}</div>${priceHtml}${aisleHtml}<div class="m-desc">${esc(p.desc)}</div><div class="m-tags">${p.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`;
  document.getElementById('modal').classList.add('show');
}
function showRecipe(i) {
  const r=allRecipes[i]; if(!r)return;
  const dc={Easy:'d-easy',Medium:'d-med',Advanced:'d-adv'};
  document.getElementById('recipeModalContent').innerHTML=`<div class="m-rname">${esc(r.name)}</div><div class="m-rdiff ${dc[r.difficulty]||'d-easy'}">${r.difficulty}</div><div class="m-sec">Ingredients</div><ul class="m-ingr">${r.ingredients.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><div class="m-sec">Method</div><ol class="m-steps">${r.steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`;
  document.getElementById('recipeModal').classList.add('show');
}
function closeModal(e){if(e.target===document.getElementById('modal'))closeModalBtn();}
function closeModalBtn(){document.getElementById('modal').classList.remove('show');}
function closeRecipeModal(e){if(e.target===document.getElementById('recipeModal'))closeRecipeModalBtn();}
function closeRecipeModalBtn(){document.getElementById('recipeModal').classList.remove('show');}
function askAboutProduct(){
  if(!currentProduct)return; closeModalBtn(); goAlex();
  setTimeout(()=>{ document.getElementById('chatInput').value=`Tell me everything about ${currentProduct.name} — what makes it special and what cocktails I could make with it.`; sendMessage(); },420);
}

/* ── Toast ── */
function showToast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),4500);}

/* ── Idle reset ── */
let _idleT;
function resetIdle(){clearTimeout(_idleT);_idleT=setTimeout(()=>{if(currentScreen!=='screen-home'){stopSpeak();chatHistory=[];goHome();}},180000);}
['click','touchstart','keydown','mousemove'].forEach(e=>document.addEventListener(e,resetIdle,{passive:true}));
resetIdle();

/* ── Util ── */
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

/* ── Home Promos (specials & events from store info) ── */
async function loadHomePromos() {
  try {
    const res = await fetch('/api/store/promos');
    if (!res.ok) return;
    const data = await res.json();
    const container = document.getElementById('homeSpecials');
    const specialsSec = document.getElementById('specialsSection');
    const eventsSec = document.getElementById('eventsSection');
    const specialsCards = document.getElementById('specialsCards');
    const eventsCards = document.getElementById('eventsCards');
    let hasContent = false;

    if (data.specials && data.specials.length > 0) {
      specialsCards.innerHTML = data.specials.map(s =>
        `<div class="promo-card"><div class="promo-card-title">🏷️ ${esc(s.title)}</div><div class="promo-card-desc">${esc(s.description)}</div>${s.expires ? `<div class="promo-card-date">Expires: ${s.expires}</div>` : ''}</div>`
      ).join('');
      specialsSec.style.display = '';
      hasContent = true;
    }

    if (data.events && data.events.length > 0) {
      eventsCards.innerHTML = data.events.map(e =>
        `<div class="promo-card event-card"><div class="promo-card-title">📅 ${esc(e.title)}</div><div class="promo-card-desc">${esc(e.description)}</div>${e.date ? `<div class="promo-card-date">${e.date}</div>` : ''}</div>`
      ).join('');
      eventsSec.style.display = '';
      hasContent = true;
    }

    if (hasContent) container.style.display = '';
  } catch(e) { console.log('Promos load error:', e); }
}

/* ── Init ── */
window.addEventListener('load',()=>{
  setTimeout(()=>{ try{init3D();}catch(e){console.warn(e);} },200);
  startSlides();
  fetch('/api/products').then(r=>r.json()).then(d=>allProducts=d).catch(()=>{});
  fetch('/api/recipes').then(r=>r.json()).then(d=>allRecipes=d).catch(()=>{});
  loadHomePromos();
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModalBtn();closeRecipeModalBtn();}});
});
