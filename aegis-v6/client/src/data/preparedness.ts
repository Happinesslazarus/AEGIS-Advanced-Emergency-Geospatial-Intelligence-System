import type { PreparednessTip, PreparednessScenario } from '../types'

export const PREPAREDNESS_TIPS: PreparednessTip[] = [
  {
    category: 'flood', icon: 'Waves', title: 'Flood Preparedness',
    before: [
      'Know your flood risk — check SEPA/EA flood maps for your area',
      'Sign up for flood warnings (Floodline: 0345 988 1188)',
      'Prepare an emergency kit with essentials for 72 hours',
      'Know where your gas, electricity and water mains shut-offs are',
      'Store important documents in waterproof bags on upper floors',
      'Install non-return valves on drains and toilets if in flood zone',
      'Have sandbags or flood barriers ready if at risk',
    ],
    during: [
      'Move to higher ground immediately if water is rising',
      'Never walk, swim or drive through flood water',
      'Turn off gas, electricity and water if safe to do so',
      'Move valuables to upper floors',
      'Keep your phone charged — you may need to call 999',
      'Listen to emergency broadcasts for instructions',
      'Avoid contact with flood water — it may be contaminated',
    ],
    after: [
      'Wait for official all-clear before returning home',
      'Do not turn on electricity until checked by professional',
      'Photograph all damage before cleaning up (for insurance)',
      'Wear protective gear (gloves, boots) during cleanup',
      'Dispose of contaminated food and medicine',
      'Watch for mould — it appears within 24-48 hours',
      'Look after your mental health — flooding is traumatic',
    ],
  },
  {
    category: 'earthquake', icon: 'Globe', title: 'Earthquake Preparedness',
    before: [
      'Identify safe spots in each room (under sturdy furniture)',
      'Secure heavy furniture and appliances to walls',
      'Know how to turn off gas, water and electricity',
      'Practice Drop, Cover, Hold On with your household',
      'Keep emergency supplies near your bed and by exits',
    ],
    during: [
      'DROP to hands and knees', 'COVER head and neck under sturdy table',
      'HOLD ON until shaking stops', 'If in bed, stay there and protect your head',
      'If outdoors, move away from buildings and power lines',
      'If driving, pull over safely away from structures',
    ],
    after: [
      'Expect aftershocks — be prepared to Drop, Cover, Hold On again',
      'Check for injuries and provide first aid',
      'Check for gas leaks (smell, hissing) — leave if detected',
      'Stay out of damaged buildings', 'Use stairs, never lifts',
      'Check on neighbours, especially elderly and vulnerable',
    ],
  },
  {
    category: 'fire', icon: 'Flame', title: 'Fire / Wildfire Preparedness',
    before: [
      'Install smoke alarms on every floor — test monthly',
      'Plan and practise escape routes from every room',
      'Keep flammable materials away from heat sources',
      'Clear vegetation within 10m of your home (wildfire areas)',
      'Know two ways out of every room',
    ],
    during: [
      'Get out, stay out, call 999', 'Crawl low under smoke',
      'Feel doors before opening — hot door means fire behind it',
      'Never go back inside a burning building',
      'For wildfire: evacuate immediately when ordered',
      'Cover nose and mouth with wet cloth if in smoke',
    ],
    after: [
      'Do not re-enter until fire service gives all-clear',
      'Be aware of hot spots that may reignite',
      'Document damage for insurance before cleanup',
      'Check for structural damage before entering',
      'Seek support for trauma — house fires are devastating',
    ],
  },
  {
    category: 'storm', icon: 'Wind', title: 'Storm / Hurricane Preparedness',
    before: [
      'Monitor weather forecasts closely',
      'Secure outdoor furniture, bins and loose objects',
      'Trim tree branches near your home',
      'Stock up on water, food, batteries, and medication',
      'Charge all devices and portable batteries',
      'Know your evacuation route',
    ],
    during: [
      'Stay indoors, away from windows',
      'Go to an interior room on the lowest floor if severe',
      'Do not use candles — use torches only',
      'Avoid phone use during lightning',
      'Never shelter under trees or near metal structures',
      'If driving, pull over away from trees and power lines',
    ],
    after: [
      'Stay away from fallen power lines and debris',
      'Check your property for damage carefully',
      'Report downed power lines to 105',
      'Check on vulnerable neighbours',
      'Be cautious of standing water — may be electrically charged',
    ],
  },
  {
    category: 'general', icon: 'Shield', title: 'General Emergency Preparedness',
    before: [
      'Create a household emergency plan and practise it',
      'Build a 72-hour emergency kit',
      'Know emergency numbers: 999, 111, 101',
      'Register for local emergency alerts',
      'Learn basic first aid and CPR',
      'Identify meeting points for your family',
      'Keep important documents in a waterproof grab bag',
    ],
    during: [
      'Stay calm and assess the situation',
      'Follow official instructions from emergency services',
      'Help others if safe to do so',
      'Keep your phone charged for emergencies only',
      'Move away from danger before calling for help',
    ],
    after: [
      'Check yourself and others for injuries',
      'Document all damage with photos',
      'Contact your insurance company promptly',
      'Accept help — there is no shame in needing support',
      'Watch for signs of stress in yourself and others',
    ],
  },
]

export const PREPAREDNESS_SCENARIOS: PreparednessScenario[] = [
  {
    id: 'flood-home', title: 'Flood Rising Around Your Home', disasterType: 'flood',
    duration: '5 mins', difficulty: 'beginner',
    description: 'You wake up to find water entering your ground floor. The rain is heavy and showing no signs of stopping. What do you do?',
    steps: [
      'Move to an upper floor immediately — take your phone, medications, and emergency kit',
      'Turn off gas, electricity and water at the mains if safe to reach them',
      'Call 999 if you or anyone is in immediate danger',
      'Do NOT attempt to walk or drive through the flood water',
      'Report the flooding via AEGIS to help emergency services coordinate',
      'Listen for emergency alerts and follow official instructions',
      'If water continues rising and you cannot get upstairs, get onto the roof if accessible',
    ],
  },
  {
    id: 'flood-driving', title: 'Encountering a Flooded Road', disasterType: 'flood',
    duration: '3 mins', difficulty: 'beginner',
    description: 'You are driving and encounter a flooded section of road. Other cars seem to be attempting to cross.',
    steps: [
      'STOP — do not attempt to drive through. Turn around and find another route.',
      'Just 30cm of water can move a car. 60cm will float most vehicles.',
      'If already in water and car stalls, stay calm. Do NOT restart the engine.',
      'Unbuckle seatbelts and unlock doors immediately',
      'If water is rising inside the car, lower windows or break a side window to escape',
      'Get to the roof of the car if needed and call 999',
      'Report the flooded road via AEGIS so others can be warned',
    ],
  },
  {
    id: 'earthquake-office', title: 'Earthquake While at Work', disasterType: 'earthquake',
    duration: '4 mins', difficulty: 'intermediate',
    description: 'You feel the building start to shake while sitting at your desk. Objects are falling off shelves.',
    steps: [
      'DROP — get on your hands and knees immediately',
      'COVER — get under your desk, protect your head and neck',
      'HOLD ON — grip the desk leg and be prepared for it to move',
      'Stay away from windows, exterior walls and heavy objects',
      'Do NOT run outside during the shaking',
      'When shaking stops, check for injuries around you',
      'Evacuate using stairs (never lifts) if building appears damaged',
      'Move to an open area away from buildings once outside',
    ],
  },
  {
    id: 'fire-home', title: 'Fire in Your Home', disasterType: 'fire',
    duration: '3 mins', difficulty: 'beginner',
    description: 'Your smoke alarm goes off in the middle of the night. You can smell smoke.',
    steps: [
      'Get out immediately — alert everyone in the house',
      'Feel the door before opening — if hot, use another exit',
      'Crawl low where air is cleaner if there is smoke',
      'Close doors behind you to slow fire spread',
      'Go to your agreed meeting point outside',
      'Call 999 from outside — never go back in',
      'Account for everyone in your household',
    ],
  },
  {
    id: 'storm-power', title: 'Storm Causes Power Outage', disasterType: 'storm',
    duration: '4 mins', difficulty: 'beginner',
    description: 'A severe storm has knocked out power in your area. Trees are down and wind is still strong.',
    steps: [
      'Stay indoors and away from windows',
      'Use torches, not candles (fire risk)',
      'Report the outage by calling 105',
      'Unplug sensitive electronics to prevent surge damage when power returns',
      'Keep fridge and freezer doors closed to preserve food',
      'Check on elderly or vulnerable neighbours when safe to go outside',
      'Stay away from downed power lines — they may still be live',
      'Follow AEGIS alerts for updates on restoration',
    ],
  },
  {
    id: 'heatwave-home', title: 'Extreme Heatwave at Home', disasterType: 'heatwave',
    duration: '5 mins', difficulty: 'beginner',
    description: 'An extreme heat warning is issued. Temperatures expected to reach 38°C for 3 consecutive days. You are at home.',
    steps: [
      'Close curtains and blinds on south/west facing windows early morning to block sun',
      'Open windows at night when cooler to ventilate the building',
      'Drink at least 2-3 litres of water throughout the day — do not wait until thirsty',
      'Avoid strenuous activity between 11am–3pm when heat peaks',
      'Check on elderly neighbours, young children, and anyone with chronic conditions',
      'Never leave children or pets in parked vehicles — even briefly',
      'Know the signs of heat exhaustion: dizziness, headache, heavy sweating, pale skin',
      'For heat stroke (no sweating, confusion, very high temp) — call 999 immediately',
      'If you have no cooling, go to an air-conditioned public space: library, shopping centre',
    ],
  },
  {
    id: 'tsunami-coastal', title: 'Tsunami Warning on Coastal Area', disasterType: 'tsunami',
    duration: '5 mins', difficulty: 'intermediate',
    description: 'You are near the coast and receive a tsunami warning after a large earthquake. The sea is receding unusually.',
    steps: [
      'Move inland and uphill IMMEDIATELY — do not wait for official confirmation to evacuate',
      'Head to ground at least 30 metres above sea level or 3km inland',
      'Do NOT go to the shore to watch — the sea receding is a danger sign, not a safe sign',
      'Abandon your vehicle if roads are congested — travel on foot if faster',
      'Follow designated tsunami evacuation route signs if present',
      'Do not return until official all-clear from authorities — multiple waves may arrive hours apart',
      'If caught in the water, grab something that floats and avoid sharp debris',
      'After the wave: beware of contaminated water, damaged infrastructure, and gas leaks',
    ],
  },
  {
    id: 'gas-leak', title: 'Suspected Gas Leak at Home', disasterType: 'fire',
    duration: '3 mins', difficulty: 'beginner',
    description: 'You smell gas in your home. There is a faint hissing sound near the kitchen.',
    steps: [
      'Do NOT turn on or off any electrical switches — even a spark can ignite gas',
      'Do NOT use your mobile phone or any open flames inside the building',
      'Open all windows and doors immediately to ventilate',
      'Turn off the gas supply at the emergency control valve (usually beside the meter)',
      'Get everyone out of the building — including pets',
      'Call the National Gas Emergency Service: 0800 111 999 (free, 24/7) from outside',
      'Do NOT re-enter until the engineer has declared it safe',
      'If you smell gas outside or see a damaged pipe, keep people away and call 999',
    ],
  },
  {
    id: 'winter-storm', title: 'Severe Blizzard / Winter Storm', disasterType: 'storm',
    duration: '6 mins', difficulty: 'intermediate',
    description: 'A red weather warning for snow is issued. You are in a rural area with 60cm of snow. Roads are closed.',
    steps: [
      'Stay at home unless travel is absolutely essential — do not attempt to drive',
      'Check your heating fuel / boiler — conserve warmth by closing off unused rooms',
      'Stock up on water in case pipes freeze or water supply is disrupted',
      'Keep a torch and spare batteries, in case power goes out',
      'If heating fails: layer clothing, use sleeping bags, move to one room with the most insulation',
      'Protect pipes: open cabinet doors under sinks, let taps drip slowly',
      'Check on neighbours — cold kills; elderly and vulnerable are at highest risk',
      'Keep rock salt / sand to hand for pathways when it is safe to go outside',
      'Monitor weather updates and AEGIS alerts for latest travel information',
    ],
  },
  {
    id: 'chemical-spill', title: 'Chemical Spill Near Your Area', disasterType: 'general',
    duration: '4 mins', difficulty: 'advanced',
    description: 'Emergency services announce a chemical spill from a lorry on a nearby road. Your area may be affected.',
    steps: [
      'Go inside immediately and stay indoors — shelter in place',
      'Close all windows, doors and vents — turn off fans and air conditioning',
      'Seal gaps under doors and windows with wet towels or tape if possible',
      'Do NOT open windows to check — rely on radio, AEGIS, or text alerts for updates',
      'Tune to local emergency radio for evacuation orders or shelter-in-place updates',
      'If you must go outside, cover your nose and mouth with a damp cloth',
      'If you feel burning in eyes, nose, or skin — flush with clean water; call 111 or 999',
      'Follow official evacuation routes if ordered — never go towards the incident',
    ],
  },
]

export const EMERGENCY_KIT_ITEMS: { item: string; icon: string; priority: 'essential' | 'important' | 'recommended' }[] = [
  { item: 'Water — 2L per person per day (3-day supply)', icon: 'Droplets', priority: 'essential' },
  { item: 'Non-perishable food (3-day supply)', icon: 'Package', priority: 'essential' },
  { item: 'Torch with spare batteries', icon: 'Flashlight', priority: 'essential' },
  { item: 'First aid kit', icon: 'Cross', priority: 'essential' },
  { item: 'Medications and prescriptions', icon: 'Pill', priority: 'essential' },
  { item: 'Phone charger / power bank', icon: 'BatteryCharging', priority: 'essential' },
  { item: 'Important documents (waterproof bag)', icon: 'FileText', priority: 'essential' },
  { item: 'Cash (ATMs may not work)', icon: 'Banknote', priority: 'important' },
  { item: 'Battery / hand-crank radio', icon: 'Radio', priority: 'important' },
  { item: 'Warm clothing and blankets', icon: 'Shirt', priority: 'important' },
  { item: 'Whistle (to signal for help)', icon: 'Volume2', priority: 'important' },
  { item: 'Dust mask / face covering', icon: 'Shield', priority: 'important' },
  { item: 'Protective gloves', icon: 'Hand', priority: 'important' },
  { item: 'Waterproof jacket / poncho', icon: 'CloudRain', priority: 'important' },
  { item: 'Spare glasses / contact lenses', icon: 'Glasses', priority: 'important' },
  { item: 'Wrench to turn off utilities', icon: 'Wrench', priority: 'recommended' },
  { item: 'Can opener (manual)', icon: 'Package', priority: 'recommended' },
  { item: 'Local maps (paper)', icon: 'Map', priority: 'recommended' },
  { item: 'Plastic sheeting and tape', icon: 'Box', priority: 'recommended' },
  { item: 'Sanitation supplies & wet wipes', icon: 'Sparkles', priority: 'recommended' },
  { item: 'Infant supplies (if applicable)', icon: 'Baby', priority: 'recommended' },
  { item: 'Pet food & supplies (if applicable)', icon: 'PawPrint', priority: 'recommended' },
  { item: 'Multi-tool / Swiss army knife', icon: 'Wrench', priority: 'recommended' },
  { item: 'Emergency contact list (printed)', icon: 'Phone', priority: 'recommended' },
]

// QUIZ QUESTIONS — data–driven, easy to expand or load from an API

export interface QuizQuestion {
  q: string
  opts: string[]
  correct: number
  category: string
  explanation: string
}

export const ALL_QUIZ: QuizQuestion[] = [
  { q: 'How deep of fast-flowing water can knock an adult off their feet?', opts: ['5cm','15cm','50cm','1 metre'], correct: 1, category: 'flood', explanation: 'Just 15cm of fast-moving water can knock you down. Never walk through flood water.' },
  { q: 'During an earthquake, you should:', opts: ['Run outside','Stand in doorway','Drop, Cover, Hold On','Call 999 immediately'], correct: 2, category: 'earthquake', explanation: 'Drop, Cover, Hold On protects you from falling objects — the leading cause of earthquake injuries.' },
  { q: 'If your clothes catch fire, you should:', opts: ['Run to find water','Stop, Drop, Roll','Remove clothing','Fan the flames out'], correct: 1, category: 'fire', explanation: 'Running feeds oxygen to the fire. Stop, Drop, and Roll smothers flames.' },
  { q: 'How many litres of water per person per day should an emergency kit have?', opts: ['0.5L','1L','2L','5L'], correct: 2, category: 'general', explanation: '2 litres per person per day for drinking. Add more for sanitation and cooking.' },
  { q: 'What should you NEVER use indoors during a power outage?', opts: ['Torch','Candles','Battery radio','Phone'], correct: 1, category: 'storm', explanation: 'Candles cause thousands of house fires each year. Use torches and battery lights instead.' },
  { q: 'After a flood, when is it safe to turn on electricity?', opts: ['Immediately','After 24 hours','When a professional checks','When water recedes'], correct: 2, category: 'flood', explanation: 'Water and electricity are deadly. Always have a qualified electrician inspect before restoring power.' },
  { q: 'What is the universal EU / UK emergency number?', opts: ['911','999','112','Both 999 and 112'], correct: 3, category: 'general', explanation: 'Both 999 and 112 work in the UK and EU for police, fire and ambulance.' },
  { q: 'During a tsunami warning, you should head to:', opts: ['The beach to watch','Low ground','High ground 30m+ above sea level','Underground shelter'], correct: 2, category: 'tsunami', explanation: 'Height is your protection. Get to at least 30m above sea level or 3km inland.' },
  { q: 'A gas leak has been confirmed in your home. You should first:', opts: ['Call gas company from inside','Switch lights off','Open all windows and leave immediately','Try to find the leak'], correct: 2, category: 'fire', explanation: 'Even turning a light switch ON or OFF can create a spark that ignites gas. Get out and call from outside.' },
  { q: 'During a heatwave, when is physical activity safest?', opts: ['Midday','12–3pm','Early morning or evening','Anytime with water'], correct: 2, category: 'heatwave', explanation: 'Heat peaks between 11am–3pm. Exercise in early morning or evening to avoid heat exhaustion.' },
  { q: 'How far inland or high should you be to be safe from a tsunami?', opts: ['100m inland','30m above sea level OR 3km inland','High-rise building','Underground bunker'], correct: 1, category: 'tsunami', explanation: 'The rule is at least 30 metres above sea level or 3 kilometres from the coast.' },
  { q: 'During an earthquake, the safest place in a building is:', opts: ['Near windows','In a doorway','Under a sturdy table away from windows','In the lift'], correct: 2, category: 'earthquake', explanation: 'Under sturdy furniture protects from falling objects. Doorways offer little protection in modern buildings.' },
  { q: 'How long should an emergency food and water supply last?', opts: ['24 hours','48 hours','72 hours (3 days)','7 days'], correct: 2, category: 'general', explanation: 'Emergency services aim to reach everyone within 72 hours. Your kit should cover at least 3 days.' },
  { q: 'When you smell gas indoors, you should NOT:', opts: ['Open windows','Leave the building','Turn light switches on or off','Call 0800 111 999'], correct: 2, category: 'fire', explanation: 'Electrical switches cause sparks which can ignite gas. Never use any electrical switch when you smell gas.' },
  { q: 'Which is a sign that a tsunami may be imminent?', opts: ['Bright sky and calm winds','The sea suddenly retreats from the shore','Rainfall increases','Birds flying inland'], correct: 1, category: 'tsunami', explanation: 'If the sea withdraws rapidly and unusually, a tsunami wave is likely to follow. Evacuate immediately.' },
  { q: 'After an earthquake, you should check for:', opts: ['Social media updates first','Gas leaks, structural damage, injuries','Food expiry dates','Nearby aftershocks on news apps'], correct: 1, category: 'earthquake', explanation: 'Immediately check for gas leaks (smell/hiss), injuries, and structural damage before doing anything else.' },
  { q: 'During a chemical spill near your home, you should:', opts: ['Open windows for fresh air','Go outside to see what is happening','Shelter in place and seal windows/doors','Drive towards the incident to help'], correct: 2, category: 'general', explanation: 'Shelter in place keeps you away from toxic fumes. Seal gaps in windows and doors, and await official guidance.' },
  { q: 'Heat stroke (not heat exhaustion) is characterised by:', opts: ['Heavy sweating and dizziness','Hot dry skin, confusion, very high temperature','Cold clammy skin','Mild headache and thirst'], correct: 1, category: 'heatwave', explanation: 'Heat stroke is a medical emergency. The body stops sweating. Call 999 immediately and cool the person.' },
  { q: 'In a flood evacuation, you should:', opts: ['Take heavy valuables','Drive through shallow water if quick','Take your emergency kit and follow official routes','Wait for water to subside first'], correct: 2, category: 'flood', explanation: 'Evacuate quickly with your emergency grab bag via official routes. Never drive through flood water — even 30cm can move a car.' },
  { q: 'The UK number to report a power cut is:', opts: ['999','112','105','0800 111 999'], correct: 2, category: 'storm', explanation: '105 is the free UK number to report and get information about power cuts, available 24/7.' },
  { q: 'What kills more people in a wildfire — the flames or the smoke?', opts: ['The flames','The smoke (toxic gases and oxygen deprivation)','Both equally','Neither — heat exposure does'], correct: 1, category: 'fire', explanation: 'Most wildfire fatalities are caused by toxic smoke inhalation. Get low, cover your nose, and evacuate upwind.' },
  { q: 'After flood water recedes, the biggest hidden danger is:', opts: ['Slippery floors','Contaminated water and mould','Structural fires','Cold temperatures'], correct: 1, category: 'flood', explanation: 'Flood water mixes with sewage and chemicals. Everything it touched is contaminated. Wear PPE for cleanup.' },
  { q: 'During a severe storm, the safest indoor location is:', opts: ['By a window to monitor conditions','The garage','An interior room on the lowest floor','In the loft'], correct: 2, category: 'storm', explanation: 'Interior rooms on lower floors are farthest from windows and flying debris, and least affected by wind.' },
  { q: 'An unconscious casualty who is breathing should be placed in:', opts: ['Flat on their back','The recovery position (on their side)','Seated upright','Left in whatever position they are in'], correct: 1, category: 'general', explanation: 'The recovery position prevents choking on vomit or the tongue blocking the airway. Call 999 first.' },
  { q: 'When should you NOT shelter under a tree during a storm?', opts: ['If it is raining','Always — never shelter under a tree','If the tree is large','Only during lightning'], correct: 1, category: 'storm', explanation: 'Trees are one of the most dangerous places in a storm — they attract lightning and branches can fall. Always avoid.' },
  { q: 'If trapped under debris after an earthquake, you should:', opts: ['Shout continuously until rescued','Move rubble with bare hands','Tap on pipes or walls and use a whistle','Stay still and silent'], correct: 2, category: 'earthquake', explanation: 'Shouting wastes energy and may inhale dust. Tapping on metal or using a whistle travels further and conserves breath.' },
  { q: 'The national UK gas emergency line is:', opts: ['999','0800 111 999','105','0800 000 123'], correct: 1, category: 'fire', explanation: '0800 111 999 is the free 24/7 National Gas Emergency Service line. Call from outside the building.' },
  { q: 'During a heatwave, elderly people are at higher risk because:', opts: ['They exercise more','Their bodies regulate temperature less efficiently','They drink more','They live in colder homes'], correct: 1, category: 'heatwave', explanation: 'As we age, the body becomes less efficient at temperature regulation and sweating. Check on older neighbours daily during heatwaves.' },
  { q: 'Before evacuating in a fire, you should:', opts: ['Gather all valuables','Close all doors behind you','Open windows to let smoke out','Announce the fire on social media'], correct: 1, category: 'fire', explanation: 'Closing doors slows the spread of fire and smoke significantly — this can save lives.' },
  { q: 'What is the correct order of priorities in an emergency (triage principle)?', opts: ['Property, then people','Call news, then help others','Safety first, then alert services, then help casualties','Help casualties, then call for help, then ensure safety'], correct: 2, category: 'general', explanation: 'Never compromise your own safety. Ensure you are safe, call 999, then assist others as trained.' },
]

// BADGES — gamification achievements

export interface Badge {
  id: string
  label: string
  desc: string
  icon: string
  condition: (completedScenarios: Set<string>, quizScore: number, quizTotal: number, kitPct: number) => boolean
}

export const BADGES: Badge[] = [
  { id: 'scenario_1', label: 'First Responder', desc: 'Complete your first scenario', icon: 'Target', condition: (s) => s.size >= 1 },
  { id: 'scenario_5', label: 'Survivor', desc: 'Complete 5 scenarios', icon: 'Trophy', condition: (s) => s.size >= 5 },
  { id: 'scenario_all', label: 'Scenario Master', desc: 'Complete all scenarios', icon: 'Star', condition: (s) => s.size >= PREPAREDNESS_SCENARIOS.length },
  { id: 'quiz_50', label: 'Quiz Starter', desc: 'Score 50%+ on quiz', icon: 'FileText', condition: (_s, score, total) => score / total >= 0.5 },
  { id: 'quiz_80', label: 'Emergency Expert', desc: 'Score 80%+ on quiz', icon: 'Award', condition: (_s, score, total) => score / total >= 0.8 },
  { id: 'quiz_100', label: 'Safety Legend', desc: 'Score 100% on quiz', icon: 'Crown', condition: (_s, score, total) => score === total },
  { id: 'kit_50', label: 'Kit Builder', desc: 'Check 50% of kit items', icon: 'Backpack', condition: (_s, _sc, _tot, kitPct) => kitPct >= 0.5 },
  { id: 'kit_all', label: 'Fully Equipped', desc: 'Check all kit items', icon: 'CheckCircle', condition: (_s, _sc, _tot, kitPct) => kitPct >= 1 },
]
