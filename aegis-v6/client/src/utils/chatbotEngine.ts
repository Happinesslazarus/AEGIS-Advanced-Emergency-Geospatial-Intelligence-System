import type { ChatResponse } from '../types'

type Intent = string

const I = {
  GREET: 'greet', FLOOD: 'flood', QUAKE: 'quake', FIRE: 'fire', STORM: 'storm',
  EVAC: 'evac', AID: 'aid', CONTACTS: 'contacts', REPORT: 'report',
  WATER: 'water', DRIVE: 'drive', SANDBAG: 'sandbag', POWER: 'power',
  SHELTER: 'shelter', SUPPLIES: 'supplies', VULN: 'vuln', PETS: 'pets',
  AFTER: 'after', STATUS: 'status', ANXIETY: 'anxiety', TRAUMA: 'trauma',
  GRIEF: 'grief', MENTAL: 'mental', CHILD_SUPPORT: 'child_support',
  TSUNAMI: 'tsunami', VOLCANO: 'volcano', LANDSLIDE: 'landslide',
  NUCLEAR: 'nuclear', TERROR: 'terror', PANDEMIC: 'pandemic',
  HEATWAVE: 'heatwave', DROUGHT: 'drought',
  THANKS: 'thanks', UNK: 'unknown',
} as const

const KW: { kw: string[]; i: Intent }[] = [
  { kw: ['hello','hi','hey','help','hola','bonjour','مرحبا','你好','नमस्ते','olá','cześć','السلام علیکم','good morning','good evening'], i: I.GREET },
  { kw: ['flood','flooding','water rising','water level','submerged','inundación','inondation','فيضان','洪水','बाढ़','enchente','powódź','سیلاب','river burst','dam'], i: I.FLOOD },
  { kw: ['earthquake','quake','shaking','tremor','terremoto','séisme','زلزال','地震','भूकंप','trzęsienie','aftershock'], i: I.QUAKE },
  { kw: ['fire','wildfire','burning','smoke','flames','incendio','feu','حريق','火灾','आग','pożar','آگ','bushfire','forest fire'], i: I.FIRE },
  { kw: ['storm','hurricane','tornado','cyclone','wind','lightning','tormenta','tempête','عاصفة','风暴','तूफान','burza','طوفان','typhoon','blizzard'], i: I.STORM },
  { kw: ['tsunami','tidal wave','سونامی','tsunami','津波'], i: I.TSUNAMI },
  { kw: ['volcano','eruption','lava','ash','volcanic','volcán','volcan','بركان','火山'], i: I.VOLCANO },
  { kw: ['landslide','mudslide','avalanche','rockfall','debris flow','deslizamiento','glissement'], i: I.LANDSLIDE },
  { kw: ['nuclear','radiation','chemical','hazmat','biohazard','contamination'], i: I.NUCLEAR },
  { kw: ['attack','terrorism','shooting','bomb','explosion','suspicious','active shooter'], i: I.TERROR },
  { kw: ['pandemic','epidemic','virus','outbreak','quarantine','covid','infection'], i: I.PANDEMIC },
  { kw: ['heatwave','heat wave','extreme heat','hot weather','heat stroke','heat exhaustion','temperature','sweltering','too hot','canicule','ola de calor','موجة حر','热浪','लू','onda de calor'], i: I.HEATWAVE },
  { kw: ['drought','dry','no rain','water shortage','crop failure','water scarcity','sécheresse','sequía','جفاف','干旱','सूखा','seca','ukame'], i: I.DROUGHT },
  { kw: ['evacuate','evacuation','leave','escape','route','way out','evacuar','évacuer'], i: I.EVAC },
  { kw: ['first aid','injured','hurt','bleeding','cpr','wound','broken','fracture'], i: I.AID },
  { kw: ['emergency number','call','phone','999','911','112','ambulance','police','fire brigade'], i: I.CONTACTS },
  { kw: ['report','submit','how to report','how do i report','reportar','signaler'], i: I.REPORT },
  { kw: ['swim','wade','walk through water','deep water','contaminated water'], i: I.WATER },
  { kw: ['drive','driving','car','vehicle','road','stuck','stranded car'], i: I.DRIVE },
  { kw: ['sandbag','barrier','protect home','waterproof','flood defence'], i: I.SANDBAG },
  { kw: ['power','electricity','blackout','outage','generator','no power','lights out'], i: I.POWER },
  { kw: ['shelter','safe place','refuge','displaced','homeless','where to go'], i: I.SHELTER },
  { kw: ['supplies','kit','emergency bag','food','water supply','essentials','preparation'], i: I.SUPPLIES },
  { kw: ['child','children','elderly','disabled','vulnerable','baby','pregnant','wheelchair'], i: I.VULN },
  { kw: ['pet','dog','cat','animal','livestock'], i: I.PETS },
  { kw: ['after flood','clean up','return home','mould','insurance','damage'], i: I.AFTER },
  { kw: ['current','now','status','situation','update','what is happening','latest'], i: I.STATUS },
  { kw: ['scared','afraid','anxious','panic','anxiety','worried','fear','nervous','terrified','can\'t breathe','heart racing','miedo','peur','خائف','害怕','डर'], i: I.ANXIETY },
  { kw: ['trauma','ptsd','nightmare','flashback','cant sleep','depressed','depression','hopeless','numb'], i: I.TRAUMA },
  { kw: ['lost someone','lost my home','lost everything','grief','mourning','devastated','miss them'], i: I.GRIEF },
  { kw: ['mental health','stressed','stress','overwhelmed','coping','struggling','support','counselling','therapy','not ok','not okay','breaking down'], i: I.MENTAL },
  { kw: ['my child is scared','children crying','kid afraid','child trauma','kids stressed','child nightmare'], i: I.CHILD_SUPPORT },
  { kw: ['thank','thanks','cheers','appreciate','helpful','great'], i: I.THANKS },
]

const R: Record<Intent, string> = {
  [I.GREET]: "Hello! I'm the AEGIS Emergency AI Assistant. I provide guidance for **all disaster types** and in **multiple languages** — ask in yours.\n\nI can help with:\n• **Safety guidance** — floods, earthquakes, fires, storms, tsunamis & more\n• **Evacuation** routes, shelters, supplies\n• **Emergency contacts** worldwide\n• **Mental health** support — if you're struggling\n• **How to report** an incident\n\nWhat do you need?",
  [I.FLOOD]: "**Flood Safety**\n\n**Water rising NOW:**\n• Move to higher ground immediately\n• **Never** walk/drive through flood water (15cm knocks you down, 60cm floats a car)\n• Turn off gas, electricity, water at mains\n• Keep phone charged\n\n**If trapped upstairs:**\n• Call 999\n• Signal from window with bright fabric or torch\n• Report via AEGIS so responders know your location\n\n**If in water:**\n• Float on back, feet downstream\n• Grab something that floats\n• Don't fight the current\n\n**Warning:** Flood water contains sewage and chemicals — avoid all contact.",
  [I.QUAKE]: "**Earthquake — DROP, COVER, HOLD ON**\n\n• **DROP** to hands and knees\n• **COVER** your head under sturdy furniture\n• **HOLD ON** until shaking stops completely\n\n**Indoors:** Stay inside. Don't run out. Away from windows and heavy objects.\n**Outdoors:** Open area, away from buildings, power lines, overpasses.\n**In bed:** Stay, protect head with pillow.\n**Driving:** Pull over, avoid bridges. Stay in vehicle.\n\n**After shaking:**\n• Expect aftershocks\n• Check for gas leaks (smell/hissing — leave if detected)\n• Use stairs, never lifts\n• Check on neighbours",
  [I.FIRE]: "**Fire Safety**\n\n**Building fire:**\n• **GET OUT, STAY OUT, CALL 999**\n• Crawl low under smoke\n• Feel doors — hot = fire behind\n• Close doors to slow spread\n• Never use lifts\n• Meeting point outside\n\n**Wildfire:**\n• Evacuate immediately when ordered\n• Close all windows and doors\n• Remove flammable items from around house\n• Wear long sleeves, mask, goggles\n• Drive slowly through smoke, headlights on\n\n**If clothes catch fire:** STOP — DROP — ROLL",
  [I.STORM]: "**Storm / Hurricane / Tornado**\n\n**Before:** Charge devices, secure outdoor objects, fill bathtub with water, identify safe room (interior, ground floor).\n\n**During storm:**\n• Stay indoors, away from windows\n• Interior room, lowest floor\n• Use torch, not candles\n\n**Tornado:** Get to basement or interior room. Cover yourself with mattress. Under stairs if no basement.\n\n**Lightning:** Get indoors. Don't use corded phones. Stay away from water.\n\n**After:** Watch for downed power lines. Don't drive through standing water.",
  [I.TSUNAMI]: "**Tsunami**\n\n**If near coast and feel earthquake or see ocean receding:**\n• **GO TO HIGH GROUND IMMEDIATELY** — at least 30m above sea level or 3km inland\n• Don't wait for official warning\n• Don't go to beach to watch\n• Stay away from rivers and streams\n\n**During:** Move inland and uphill. If caught, grab something that floats.\n**After:** Stay away from coast until all-clear. Multiple waves can arrive hours apart.",
  [I.VOLCANO]: "**Volcanic Eruption**\n\n• Follow evacuation orders — don't try to outrun lava\n• If caught in ash fall: mask/cloth over mouth, goggles, long sleeves\n• Get indoors, close all windows and doors\n• Don't drive in heavy ash (clogs engines)\n• Avoid river valleys (lahars — volcanic mudflows)\n• Protect water supplies\n• Clear ash from roofs (heavy — can collapse buildings)",
  [I.LANDSLIDE]: "**Landslide / Mudslide**\n\n**Warning signs:** Unusual sounds (rumbling), ground cracks, tilting trees, bulging ground, water seeping.\n\n• **Move away** from the path of the slide\n• Go to higher ground if possible\n• If caught: curl into a tight ball, protect your head\n• After: stay away — more slides can follow\n• Report blocked roads and damage via AEGIS",
  [I.NUCLEAR]: "**Chemical / Nuclear / HAZMAT**\n\n• **Get inside, stay inside, stay tuned**\n• Close all windows, doors, vents, fireplace dampers\n• If outdoors: cover nose/mouth, move upwind\n• Remove contaminated clothing, bag it, shower\n• Don't eat/drink anything exposed\n• Follow official instructions — tune to emergency radio\n• Don't spread unverified information",
  [I.TERROR]: "**Security Incident**\n\n**RUN — HIDE — TELL**\n• **RUN** to a safe place if you can\n• **HIDE** — lock/barricade doors, silence phone, turn off lights\n• **TELL** — call 999 when safe\n\nDon't assume it's over after one incident.\nDon't share live suspect locations on social media.\nFollow police instructions exactly.",
  [I.PANDEMIC]: "**Pandemic / Health Emergency**\n\n• Follow government health guidelines\n• Wash hands frequently (20+ seconds)\n• Wear mask in crowded/indoor spaces\n• Maintain distance\n• Stay home if symptomatic\n• Get vaccinated when available\n• Stock 2 weeks of essentials\n• Call NHS 111 before visiting hospital if sick",
  [I.EVAC]: "**Evacuation Guide**\n\n**Take:** Emergency kit, medications, documents (waterproof bag), phone + charger, keys, cash\n**Do:** Turn off utilities, lock up, tell someone your destination\n**Don't:** Take shortcuts, drive through water, delay\n\n**Routes:** Check AEGIS map for recommended routes and shelters.\n\n**If told to shelter in place:** Stay inside, close windows/doors, wait for all-clear.",
  [I.AID]: "**First Aid**\n\n**Bleeding:** Apply firm direct pressure with clean cloth.\n**Burns:** Cool under running water 20 mins. Don't pop blisters.\n**Fractures:** Immobilise. Don't move unless danger.\n**CPR:** 30 chest compressions, 2 rescue breaths. Push hard and fast.\n**Hypothermia:** Warm place, remove wet clothes, warm blankets, warm (not hot) drinks.\n\n**Warning: Call 999 for serious injuries.** Don't move spinal injuries.",
  [I.CONTACTS]: "**Emergency Contacts**\n\n**UK:** 999 (emergency) | 111 (NHS) | 101 (police) | 0345 988 1188 (Floodline)\n**USA:** 911 | FEMA: 1-800-621-3362\n**EU:** 112 (universal emergency)\n**Australia:** 000 | SES: 132 500\n**India:** 112 | NDRF: 011-26107953\n\n**Mental health:** Samaritans 116 123 (UK, 24/7) | Crisis text: SHOUT to 85258\n**Power outage:** 105 (UK)\n**Red Cross:** 0800 068 4141",
  [I.REPORT]: "**How to Report**\n\n1. Tap **'Report Emergency'** button\n2. Select incident type (flood, fire, etc.)\n3. Choose specific subtype\n4. Describe what you see (be specific)\n5. Rate severity\n6. Say if anyone is trapped\n7. Add location (GPS or type it)\n8. Upload photo/video if safe to do so\n\n**Reports are anonymous** — no login required.\nAI automatically verifies and assigns confidence score.\n\n**Call 999 first for life-threatening emergencies.**",
  [I.WATER]: "**Flood Water — NEVER enter it**\n\n• 15cm fast water knocks adults down\n• Contains sewage, chemicals, rats, debris\n• Open manholes are invisible underneath\n• Electrical hazards from submerged cables\n\n**If exposed:** Wash thoroughly with soap. See doctor if unwell.",
  [I.DRIVE]: "**Driving in Floods — DON'T**\n\n• 30cm moves a car. 60cm floats it.\n• You can't see road damage under water\n• Engine ingests water and dies\n\n**Already trapped?**\n1. Stay calm. Engine off.\n2. Unbuckle seatbelts immediately.\n3. Open/break side window.\n4. Get out, get to higher ground.\n5. Call 999.\n\n**Never cross a flooded road.** Turn around.",
  [I.SANDBAG]: "**Flood Protection**\n\n**Sandbags:** Stack in pyramid (3-2-1), pack tight, fold tops under. Plastic sheeting behind.\n**No sandbags?** Pillowcases + soil, bin bags + earth, towels.\n**Seal:** Block doors, toilets, air bricks with plastic + tape.\n**Move:** Valuables upstairs. Unplug electrics.\n\nContact council for emergency supplies.",
  [I.POWER]: "**Power Outage**\n• Call **105** (UK) to report\n• Stay 10m from downed power lines — **always assume live**\n• Use torches, **not candles**\n• Keep fridge/freezer closed\n• **Never run generators indoors** (carbon monoxide kills)\n• Unplug electronics to prevent surge damage",
  [I.SHELTER]: "**Finding Shelter**\n\nCheck AEGIS map for marked shelters and Community Help section for nearby offers.\n\n**Council emergency housing:** 01224 522000 (Aberdeen)\n**Red Cross:** 0800 068 4141\n**Salvation Army:** 020 7367 4500\n\n**Bring:** ID, medications, phone charger, clothes, comfort items for children.",
  [I.SUPPLIES]: "**Emergency Kit (72-hour)**\n\n• Water (2L/person/day)\n• Non-perishable food\n• Torch + batteries\n• First aid kit\n• Medications (7-day supply)\n• Documents in waterproof bag\n• Phone charger / power bank\n• Cash\n• Warm clothes + blankets\n• Battery radio\n• Whistle\n• Can opener\n• Local map (paper)\n\nCheck Preparedness Guide for full interactive checklist.",
  [I.VULN]: "**Protecting Vulnerable People**\n\n**Children:** Stay calm (they mirror you), explain simply, maintain routines, let them express feelings.\n**Elderly:** Check on them regularly, ensure meds accessible, help with mobility.\n**Disabled:** Ensure aids are charged/accessible, have backup communication method.\n**Pregnant:** Avoid flood water (infection risk), seek medical attention early.\n\nCall 999 if anyone needs evacuation assistance.",
  [I.PETS]: "**Pet Safety**\n\n• Include pets in evacuation plan\n• Pet kit: food, water, carrier, meds, ID tags\n• Keep on lead during evacuation\n• Never leave tied outside\n• Never leave in car during heat\n\n**RSPCA:** 0300 1234 999 | **SSPCA (Scotland):** 03000 999 999",
  [I.AFTER]: "**After a Disaster**\n\n1. Wait for official all-clear\n2. Check for structural damage before entering\n3. Don't turn on electricity until professional checks\n4. Wear PPE for cleanup (gloves, mask, boots)\n5. Photograph everything for insurance\n6. Dispose of contaminated food\n7. Watch for mould (24-48 hours)\n8. Contact insurer promptly\n\n**Your mental health matters.** Disasters are traumatic — see our mental health resources.",
  [I.STATUS]: "**Current Situation**\n\nCheck the AEGIS dashboard for:\n• Active alerts and warnings\n• Live disaster map with reports\n• Weather conditions\n• Flood predictions\n\nAll updated in real-time from operator-verified data.",
  [I.ANXIETY]: "**It's okay to feel scared.** That's your body trying to protect you.\n\n**Right now, try this:**\n• Slow breaths — in 4, hold 4, out 6\n• Name 5 things you can see (grounding)\n• Focus on what you **can** control\n• You don't need all the answers right now\n\n**You are not alone.**\n• **Samaritans:** 116 123 (24/7, free)\n• **Crisis text:** Text SHOUT to 85258\n• **Breathing Space (Scotland):** 0800 83 85 87\n\nWould you like practical safety info to feel more in control?",
  [I.TRAUMA]: "**What you've been through matters.** Your feelings are valid.\n\nCommon reactions: sleep problems, flashbacks, numbness, being on edge. These are **normal responses to abnormal events.**\n\n**What helps:**\n• Talk to someone you trust\n• Keep routines — eating, sleeping, walking\n• Be patient with yourself\n• Limit news if overwhelming\n• Physical activity processes stress\n\n**Professional support:**\n• **Samaritans:** 116 123 (24/7)\n• **Mind:** 0300 123 3393\n• **NHS 111** — ask about IAPT referral\n• **GP** for counselling referral\n\n**Seeking help is strength.**",
  [I.GRIEF]: "**I'm sorry for your loss.** Whether home, belongings, safety, or someone you love — grief is grief.\n\n• No right way to grieve\n• Waves are normal\n• Accepting help isn't weakness\n\n**Support:**\n• **Samaritans:** 116 123\n• **Cruse Bereavement:** 0808 808 1677\n• **Red Cross:** 0800 068 4141\n• **GP** for counselling\n\nNeed practical help with insurance or shelter?",
  [I.MENTAL]: "**Your mental health matters.**\n\nCommon after disasters: sleep issues, irritability, replaying events, worry, physical symptoms (headaches, fatigue).\n\n**What helps:**\n• Stay connected with people\n• Keep basic routines\n• Be kind to yourself\n• Limit distressing news\n• Accept help\n\n**24/7 Support:**\n• **Samaritans:** 116 123\n• **Crisis text:** SHOUT to 85258\n• **NHS 111** press 2 for mental health\n• **Mind:** 0300 123 3393\n\n**You don't have to cope alone.**",
  [I.CHILD_SUPPORT]: "**Helping a scared child:**\n\n• Stay calm — they mirror your emotions\n• Simple honest explanations: \"There's been flooding. We're safe. Adults are fixing it.\"\n• Physical comfort — hugs, holding, favourite toy\n• Let them express through talking, drawing, play\n• Maintain routines where possible\n• Limit their exposure to news\n\n**Normal reactions:** clinginess, bedwetting, nightmares, appetite changes\n\n**If worried:**\n• **Childline:** 0800 1111\n• **NSPCC:** 0808 800 5000\n• **GP** for specialist referral\n\nChildren are resilient with a caring adult beside them.",
  [I.HEATWAVE]: "**Extreme Heat / Heatwave**\n\n**Stay cool:**\n• Stay indoors during peak heat (11am-3pm)\n• Close blinds/curtains on sun-facing windows\n• Open windows at night for cool air\n• Use fans + damp towels\n\n**Stay hydrated:**\n• Drink water regularly — don't wait until thirsty\n• Avoid alcohol, caffeine, and sugary drinks\n\n**Signs of heat stroke (emergency — call 999):**\n• High body temp (above 40C), confusion, no sweating\n• Cool person immediately: ice packs to neck/armpits/groin, fan them\n\n**Heat exhaustion (not emergency but serious):**\n• Heavy sweating, pale skin, fast weak pulse, nausea\n• Move to cool place, lie down, sip water\n\n**Protect others:**\n• Check on elderly, young children, pets\n• Never leave anyone in a parked car",
  [I.DROUGHT]: "**Drought — Water Scarcity**\n\n**Conserve water:**\n• Fix any leaks immediately\n• Short showers (4 min), not baths\n• Only run dishwasher/washing machine when full\n• Collect grey water to water plants\n• Water garden in early morning or evening\n\n**Food and farming:**\n• Check crop damage reports via AEGIS\n• Water restrictions may be in effect — follow local authority guidance\n• Avoid burning (fire risk is elevated during drought)\n\n**Health and safety:**\n• Drink sufficient water — dehydration risk is higher\n• Watch for dust and reduced air quality\n• Rivers and reservoirs may be lower — drowning risk at edges\n\n**Report:** Use AEGIS to report water supply disruptions or critically low river levels.",
  [I.THANKS]: "You're welcome! Stay safe. I'm here anytime you need guidance.\n\nRemember: **999 for emergencies** | **AEGIS for reporting**",
  [I.UNK]: "I can help with:\n\n• **Any disaster** — flood, earthquake, fire, storm, tsunami, volcano, landslide, heatwave, drought, nuclear, pandemic\n• **Evacuation, shelter, supplies**\n• **Emergency contacts** (UK, US, EU, Australia, India)\n• **Mental health** support\n• **First aid** basics\n• **How to report** incidents\n\nI understand **multiple languages** — ask in yours!\n\nTry: \"What do I do in a flood?\", \"Heatwave safety\", \"Drought water tips\", or \"emergency numbers\"",
}

function detect(msg: string): { intent: Intent; conf: number } {
  const low = msg.toLowerCase().trim()
  let best = { intent: I.UNK as Intent, score: 0 }
  for (const m of KW) {
    let score = 0
    for (const k of m.kw) if (low.includes(k)) score += k.split(' ').length * (k.length > 5 ? 2 : 1)
    if (score > best.score) best = { intent: m.i, score }
  }
  return { intent: best.intent, conf: best.intent === I.UNK ? 0.15 : Math.min(0.95, 0.6 + best.score * 0.08) }
}

export function generateChatResponse(message: string): ChatResponse {
  const { intent, conf } = detect(message)
  return { text: R[intent], intent, confidence: conf }
}

export function getSuggestions(lang: string = 'en'): string[] {
  const s: Record<string, string[]> = {
    en: ['What do I do in a flood?', 'Heatwave safety tips', 'Drought water conservation', 'I feel overwhelmed', 'Emergency contacts', 'How to report', 'Earthquake safety', 'My child is scared', 'Emergency kit list'],
    es: ['¿Qué hago en una inundación?', 'Consejos para ola de calor', 'Contactos de emergencia', 'Me siento abrumado'],
    fr: ["Que faire en cas d'inondation?", 'Conseils canicule', "Contacts d'urgence", 'Je suis dépassé'],
    ar: ['ماذا أفعل في الفيضان؟', 'نصائح موجة الحر', 'جهات اتصال الطوارئ', 'أشعر بالقلق'],
    zh: ['洪水中该怎么办？', '热浪安全提示', '干旱节水建议', '紧急联系方式', '我很焦虑'],
    hi: ['बाढ़ में क्या करें?', 'लू से बचाव', 'सूखे में पानी बचाएं', 'आपातकालीन संपर्क', 'मुझे चिंता हो रही है'],
    de: ['Was tun bei einer Überschwemmung?', 'Hitzewell-Sicherheitstipps', 'Notrufnummern', 'Ich fühle mich überfordert'],
    pt: ['O que fazer em uma inundação?', 'Dicas para onda de calor', 'Contactos de emergência', 'Estou me sentindo sobrecarregado'],
    sw: ['Nifanye nini wakati wa mafuriko?', 'Vidokezo vya wimbi la joto', 'Nambari za dharura', 'Ninahisi kuzidiwa'],
  }
  return s[lang] || s.en
}
