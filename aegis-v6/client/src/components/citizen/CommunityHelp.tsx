/**
 * Community help citizen component (public-facing UI element).
 *
 * - Rendered inside CitizenPage.tsx or CitizenDashboard.tsx */

/* CommunityHelp.tsx — Community mutual aid board for citizens to offer/request help. */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { X, Heart, HelpCircle, MapPin, Clock, Phone, ExternalLink, Navigation, Shield, AlertTriangle, Flag, Home, Droplets, Car, HeartPulse, Shirt, Crosshair, Star, Lock, UserCheck, Info, CheckCircle, Search, Globe, Loader2 } from 'lucide-react'
import { COMMUNITY_HELP_TYPES } from '../../data/disasterTypes'
import { useAlerts } from '../../contexts/AlertsContext'
import { useLocation } from '../../contexts/LocationContext'
import { useCitizenAuth, getCitizenToken } from '../../contexts/CitizenAuthContext'
import { getLanguage, t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { buildTranslationMap } from '../../utils/translateService'
import { getEmergencyInfo } from '../../data/allCountries'

interface Props { onClose: () => void }
interface Resource { name: string; type: string; address: string; phone: string; hours: string; dist: string; url: string }
interface Post {
  id: number
  type: string
  name: string
  description: string
  location: string
  time: string
  verified?: boolean
  rating?: number
  safe_meeting?: string
  translationEligible?: boolean
}

const TYPE_ICONS: Record<string, any> = { shelter: Home, food: Droplets, transport: Car, medical: HeartPulse, clothing: Shirt }

const RESOURCES: Record<string, Resource[]> = {
  aberdeen: [
    { name: 'Aberdeen City Council Emergency Housing', type: 'shelter', address: 'Marischal College, Broad St AB10 1AB', phone: '01224 522000', hours: '24/7 emergencies', dist: '0.4mi', url: 'https://www.aberdeencity.gov.uk' },
    { name: 'British Red Cross Aberdeen', type: 'shelter', address: '29 Queens Rd AB15 4YL', phone: '0800 068 4141', hours: 'Mon-Fri 9-5', dist: '1.2mi', url: 'https://www.redcross.org.uk' },
    { name: 'Salvation Army Aberdeen', type: 'shelter', address: '9 Castle Terrace AB11 5DP', phone: '01224 582221', hours: '24/7', dist: '0.5mi', url: 'https://www.salvationarmy.org.uk' },
    { name: 'Aberdeen Foyer Emergency Housing', type: 'shelter', address: '90 Marywell St AB11 6JF', phone: '01224 252200', hours: '24/7', dist: '0.6mi', url: 'https://www.aberdeenfoyer.com' },
    { name: 'Aberdeen Cyrenians Food Bank', type: 'food', address: '41 Summer St AB10 1SB', phone: '01224 625732', hours: 'Mon-Fri 10-3', dist: '0.6mi', url: 'https://www.cyrenians.scot' },
    { name: 'CFINE Community Food', type: 'food', address: '2-4 Poynernook Rd AB11 5RW', phone: '01224 596156', hours: 'Mon-Fri 9-5', dist: '0.8mi', url: 'https://www.cfine.org' },
    { name: 'Trussell Trust Food Bank Aberdeen', type: 'food', address: 'Gerrard St Baptist Church AB25 1NE', phone: '01224 485858', hours: 'Mon/Wed/Fri 10-2', dist: '0.9mi', url: 'https://www.trusselltrust.org' },
    { name: 'First Bus Emergency Service', type: 'transport', address: 'King Street depot', phone: '01224 650065', hours: 'See emergency routes', dist: 'City-wide', url: 'https://www.firstbus.co.uk' },
    { name: 'Aberdeen Taxis 24/7', type: 'transport', address: 'City-wide', phone: '01224 878787', hours: '24/7', dist: 'City-wide', url: '' },
    { name: 'Scottish Ambulance Service', type: 'transport', address: 'Regional', phone: '999 / 111', hours: '24/7', dist: 'Regional', url: 'https://www.scottishambulance.com' },
    { name: 'NHS Grampian A&E', type: 'medical', address: 'Aberdeen Royal Infirmary, Foresterhill AB25 2ZN', phone: '0345 456 6000', hours: '24/7', dist: '1.5mi', url: 'https://www.nhsgrampian.org' },
    { name: 'Samaritans Aberdeen', type: 'medical', address: '60 Dee St AB11 6DS', phone: '116 123', hours: '24/7 free', dist: '0.3mi', url: 'https://www.samaritans.org' },
    { name: 'NHS 24 Health Line', type: 'medical', address: 'Phone service', phone: '111', hours: '24/7', dist: 'National', url: 'https://www.nhs24.scot' },
    { name: 'Instant Neighbour', type: 'clothing', address: '94 John St AB25 1LG', phone: '01224 621699', hours: 'Mon-Fri 9:30-3', dist: '0.7mi', url: 'https://www.instantneighbour.co.uk' },
    { name: 'Salvation Army Clothing Bank', type: 'clothing', address: '9 Castle Terrace AB11 5DP', phone: '01224 582221', hours: 'Mon-Sat 10-4', dist: '0.5mi', url: 'https://www.salvationarmy.org.uk' },
  ],
  edinburgh: [
    { name: 'Edinburgh City Council Emergency Housing', type: 'shelter', address: 'Waverley Court, 4 East Market St EH8 8BG', phone: '0131 200 2000', hours: '24/7', dist: 'City-wide', url: 'https://www.edinburgh.gov.uk' },
    { name: 'Scottish Flood Forum', type: 'shelter', address: 'Edinburgh', phone: '01786 432 717', hours: 'Mon-Fri 9-5', dist: 'National', url: 'https://scottishfloodforum.org' },
    { name: 'Salvation Army Edinburgh', type: 'shelter', address: '20 Bonnington Road EH6 5JD', phone: '0131 554 0696', hours: '24/7', dist: '1.5mi', url: 'https://www.salvationarmy.org.uk' },
    { name: 'Edinburgh Simon Community', type: 'shelter', address: 'City-wide', phone: '0800 028 8999', hours: '24/7', dist: 'City-wide', url: 'https://www.simonscotland.org' },
    { name: 'Shelter Scotland Edinburgh', type: 'shelter', address: '6 South Charlotte St EH2 4AW', phone: '0808 800 4444', hours: 'Mon-Fri 9-5', dist: '0.5mi', url: 'https://scotland.shelter.org.uk' },
    { name: 'Edinburgh Food Bank (Trussell Trust)', type: 'food', address: 'Various city locations', phone: '0131 555 5555', hours: 'Varies by site', dist: 'City-wide', url: 'https://edinburgh.foodbank.org.uk' },
    { name: 'Bethany Christian Trust', type: 'food', address: '65 Bonnington Road EH6 5JQ', phone: '0131 561 8930', hours: 'Mon-Fri 9-5', dist: '1.5mi', url: 'https://bethanychristiantrust.com' },
    { name: 'Cyrenians Edinburgh', type: 'food', address: '40 Pilrig St EH6 5AL', phone: '0131 556 6616', hours: 'Mon-Fri 8-6', dist: '1.2mi', url: 'https://www.cyrenians.scot' },
    { name: 'Lothian Buses Emergency Routes', type: 'transport', address: 'City-wide', phone: '0131 554 4494', hours: 'Emergency schedule', dist: 'City-wide', url: 'https://www.lothianbuses.com' },
    { name: 'Edinburgh Taxis', type: 'transport', address: 'City-wide', phone: '0131 228 1211', hours: '24/7', dist: 'City-wide', url: '' },
    { name: 'Scottish Ambulance Service', type: 'transport', address: 'Regional', phone: '999 / 111', hours: '24/7', dist: 'Regional', url: 'https://www.scottishambulance.com' },
    { name: 'Royal Infirmary A&E (NHS Lothian)', type: 'medical', address: '51 Little France Crescent EH16 4SA', phone: '0131 536 1000', hours: '24/7', dist: '3mi', url: 'https://www.nhslothian.scot' },
    { name: 'Western General Hospital', type: 'medical', address: 'Crewe Road South EH4 2XU', phone: '0131 537 1000', hours: '24/7', dist: '2mi', url: 'https://www.nhslothian.scot' },
    { name: 'NHS 24 Health Line', type: 'medical', address: 'Phone service', phone: '111', hours: '24/7', dist: 'National', url: 'https://www.nhs24.scot' },
    { name: 'Blythswood Care Edinburgh', type: 'clothing', address: 'Edinburgh area', phone: '01463 221 011', hours: 'Mon-Fri 9-5', dist: 'City-wide', url: 'https://www.blythswood.org' },
  ],
  glasgow: [
    { name: 'Glasgow City Council Emergency', type: 'shelter', address: 'City Chambers, 80 George Sq G2 1DU', phone: '0141 287 2000', hours: '24/7', dist: 'City-wide', url: 'https://www.glasgow.gov.uk' },
    { name: 'Glasgow Simon Community', type: 'shelter', address: 'City-wide', phone: '0800 028 8999', hours: '24/7', dist: 'City-wide', url: 'https://www.simonscotland.org' },
    { name: 'Salvation Army Glasgow', type: 'shelter', address: '840 Govan Rd G51 3UU', phone: '0141 427 8400', hours: '24/7', dist: '2mi', url: 'https://www.salvationarmy.org.uk' },
    { name: 'Shelter Scotland Glasgow', type: 'shelter', address: '53 St Vincent Crescent G3 8NG', phone: '0808 800 4444', hours: 'Mon-Fri 9-5', dist: '0.8mi', url: 'https://scotland.shelter.org.uk' },
    { name: 'Lodging House Mission', type: 'shelter', address: '35 East Campbell Street G1 5DT', phone: '0141 552 0285', hours: '24/7', dist: '0.5mi', url: 'https://www.lhm.org.uk' },
    { name: 'Glasgow Foodbank (Trussell Trust)', type: 'food', address: 'Various locations', phone: '0141 550 5452', hours: 'Varies', dist: 'City-wide', url: 'https://glasgow.foodbank.org.uk' },
    { name: 'Loaves & Fishes', type: 'food', address: '94 Havannah St G4 0TW', phone: '0141 552 4678', hours: 'Mon-Fri 11-2', dist: '0.5mi', url: '' },
    { name: 'Glasgow City Mission', type: 'food', address: '20 Crimea Street G2 8PW', phone: '0141 553 2777', hours: 'Mon-Fri 8-4', dist: '0.4mi', url: 'https://gcm.org.uk' },
    { name: 'First Glasgow Buses Emergency', type: 'transport', address: 'City-wide', phone: '0141 423 6600', hours: 'Emergency routes', dist: 'City-wide', url: 'https://www.firstbus.co.uk' },
    { name: 'Glasgow Taxis', type: 'transport', address: 'City-wide', phone: '0141 429 7070', hours: '24/7', dist: 'City-wide', url: '' },
    { name: 'Scottish Ambulance Service', type: 'transport', address: 'Regional', phone: '999 / 111', hours: '24/7', dist: 'Regional', url: 'https://www.scottishambulance.com' },
    { name: 'Queen Elizabeth University Hospital A&E', type: 'medical', address: '1345 Govan Road G51 4TF', phone: '0141 201 1100', hours: '24/7', dist: '2.5mi', url: 'https://www.nhsggc.scot' },
    { name: 'Glasgow Royal Infirmary A&E', type: 'medical', address: '84 Castle Street G4 0SF', phone: '0141 211 4000', hours: '24/7', dist: '0.8mi', url: 'https://www.nhsggc.scot' },
    { name: 'NHS 24 Health Line', type: 'medical', address: 'Phone service', phone: '111', hours: '24/7', dist: 'National', url: 'https://www.nhs24.scot' },
    { name: 'Blythswood Care Glasgow', type: 'clothing', address: 'Glasgow area', phone: '01463 221 011', hours: 'Mon-Fri 9-5', dist: 'City-wide', url: 'https://www.blythswood.org' },
  ],
  dundee: [
    { name: 'Dundee City Council Emergency Housing', type: 'shelter', address: 'City Square DD1 3BY', phone: '01382 434000', hours: '24/7', dist: 'City-wide', url: 'https://www.dundeecity.gov.uk' },
    { name: 'Salvation Army Dundee', type: 'shelter', address: '8 Roseangle DD1 4LS', phone: '01382 226 626', hours: '24/7', dist: '1mi', url: 'https://www.salvationarmy.org.uk' },
    { name: 'Simon Community Scotland', type: 'shelter', address: 'Tayside area', phone: '0800 028 8999', hours: '24/7', dist: 'Regional', url: 'https://www.simonscotland.org' },
    { name: 'Shelter Scotland Dundee', type: 'shelter', address: 'Dundee', phone: '0808 800 4444', hours: 'Mon-Fri 9-5', dist: 'City-wide', url: 'https://scotland.shelter.org.uk' },
    { name: 'Dundee Foodbank (Trussell Trust)', type: 'food', address: 'Various locations', phone: '01382 322345', hours: 'Varies', dist: 'City-wide', url: 'https://dundee.foodbank.org.uk' },
    { name: 'DVVA Volunteer Centre', type: 'food', address: '10 Constitution Rd DD1 1LL', phone: '01382 305730', hours: 'Mon-Fri 9-5', dist: '0.5mi', url: 'https://www.dvva.scot' },
    { name: 'Tayside Council on Alcohol', type: 'food', address: 'Dundee', phone: '01382 322658', hours: 'Mon-Fri 9-5', dist: 'City-wide', url: '' },
    { name: 'Xplore Dundee Buses Emergency', type: 'transport', address: 'City-wide', phone: '01382 228054', hours: 'Emergency routes', dist: 'City-wide', url: 'https://www.xploredundee.com' },
    { name: 'Dundee Taxis', type: 'transport', address: 'City-wide', phone: '01382 223344', hours: '24/7', dist: 'City-wide', url: '' },
    { name: 'Scottish Ambulance Service', type: 'transport', address: 'Tayside', phone: '999 / 111', hours: '24/7', dist: 'Regional', url: 'https://www.scottishambulance.com' },
    { name: 'Ninewells Hospital A&E', type: 'medical', address: 'Ninewells, Dundee DD1 9SY', phone: '01382 660111', hours: '24/7', dist: '2mi', url: 'https://www.nhstayside.scot.nhs.uk' },
    { name: 'NHS 24 Health Line', type: 'medical', address: 'Phone service', phone: '111', hours: '24/7', dist: 'National', url: 'https://www.nhs24.scot' },
    { name: 'Dundee Clothing Bank', type: 'clothing', address: 'Dundee city centre', phone: '01382 434000', hours: 'Mon-Sat 10-4', dist: 'City-wide', url: '' },
  ],
  generic: [
    { name: 'Local Emergency Services', type: 'shelter', address: 'Call first responders', phone: '112 (EU) — 911 (US) — 999 (UK) — 000 (AU)', hours: '24/7', dist: 'Nearest', url: '' },
    { name: 'International Red Cross / Red Crescent', type: 'shelter', address: 'Country-wide offices', phone: '+41 22 734 60 01', hours: '24/7', dist: 'Varies', url: 'https://www.icrc.org' },
    { name: 'UNHCR Emergency Shelter', type: 'shelter', address: 'Global operations', phone: '+41 22 739 81 11', hours: '24/7', dist: 'Varies', url: 'https://www.unhcr.org' },
    { name: 'Salvation Army (Worldwide)', type: 'shelter', address: 'National offices worldwide', phone: 'See local listing', hours: '24/7 in emergencies', dist: 'Nearest city', url: 'https://www.salvationarmy.org' },
    { name: 'Community Emergency Centres', type: 'shelter', address: 'Local churches, community halls, schools', phone: 'Ask local authority or police', hours: 'During emergencies', dist: 'Nearest', url: '' },
    { name: 'World Food Programme (WFP)', type: 'food', address: 'Global distribution networks', phone: '+39 06 6513 1', hours: '24/7', dist: 'Varies', url: 'https://www.wfp.org' },
    { name: 'Local Food Bank / Pantry', type: 'food', address: 'Ask council, church or police', phone: 'Local authority', hours: 'Varies by site', dist: 'Nearest', url: 'https://www.foodbanks.org' },
    { name: 'Red Cross Food Aid', type: 'food', address: 'Distribution centres — check local branch', phone: 'Local Red Cross number', hours: 'Emergency hours', dist: 'Regional', url: 'https://www.redcross.org' },
    { name: 'Nearest A&E / Emergency Room', type: 'medical', address: 'Search online or ask police', phone: '112 (EU) — 911 (US) — 999 (UK)', hours: '24/7', dist: 'Nearest', url: '' },
    { name: 'WHO Health Emergencies', type: 'medical', address: 'Global coordination', phone: '+41 22 791 21 11', hours: '24/7', dist: 'Varies', url: 'https://www.who.int/emergencies' },
    { name: 'Crisis / Mental Health Helpline', type: 'medical', address: 'Phone / text service', phone: '116 123 (EU) — 988 (US) — 13 11 14 (AU)', hours: '24/7', dist: 'National', url: 'https://www.samaritans.org' },
    { name: 'Doctors Without Borders (MSF)', type: 'medical', address: 'Deployed to disaster zones', phone: '+32 2 474 74 74', hours: '24/7 in major emergencies', dist: 'Varies', url: 'https://www.msf.org' },
    { name: 'Local Bus / Metro Emergency Routes', type: 'transport', address: 'Ask local authority or police', phone: 'Local transport authority', hours: 'Emergency schedule', dist: 'City-wide', url: '' },
    { name: 'Taxi / Ride-share Services', type: 'transport', address: 'City-wide', phone: 'Uber / local taxi', hours: '24/7 (where available)', dist: 'City-wide', url: 'https://www.uber.com' },
    { name: 'National Ambulance / EMS', type: 'transport', address: 'Emergency only', phone: '112 — 911 — 999 — 000', hours: '24/7', dist: 'Regional', url: '' },
    { name: 'Red Cross Emergency Clothing', type: 'clothing', address: 'Distribution centres — check local branch', phone: 'Local Red Cross', hours: 'Emergency hours', dist: 'Regional', url: 'https://www.redcross.org' },
    { name: 'Salvation Army Clothing Centres', type: 'clothing', address: 'National stores / emergency centres', phone: 'See local listing', hours: 'Varies', dist: 'Nearest', url: 'https://www.salvationarmy.org' },
    { name: 'Caritas / Church Aid Clothing', type: 'clothing', address: 'Global aid programmes', phone: 'Local Caritas office', hours: '24/7 in emergencies', dist: 'Varies', url: 'https://www.caritas.org' },
  ],
  london: [
    { name: 'London Borough Council Emergency', type: 'shelter', address: 'Your local borough town hall', phone: '020 7332 1000', hours: '24/7', dist: 'Borough-wide', url: 'https://www.london.gov.uk' },
    { name: 'Shelter England London', type: 'shelter', address: '88 Old St EC1V 9HU', phone: '0808 800 4444', hours: 'Mon-Fri 8-8, Sat-Sun 9-5', dist: '0.5mi', url: 'https://england.shelter.org.uk' },
    { name: 'British Red Cross London', type: 'shelter', address: '44 Moorfields EC2Y 9AL', phone: '0344 871 1111', hours: 'Mon-Fri 9-5', dist: '0.3mi', url: 'https://www.redcross.org.uk' },
    { name: 'Salvation Army London Central', type: 'shelter', address: '101 Newington Causeway SE1 6BN', phone: '020 7367 4500', hours: '24/7', dist: '1mi', url: 'https://www.salvationarmy.org.uk' },
    { name: 'Trussell Trust London Foodbanks', type: 'food', address: 'Multiple locations', phone: '020 7520 5152', hours: 'Varies by site', dist: 'City-wide', url: 'https://www.trusselltrust.org' },
    { name: 'Felix Project', type: 'food', address: 'Multiple depots', phone: '020 3034 3100', hours: 'Mon-Fri 8-6', dist: 'City-wide', url: 'https://thefelixproject.org' },
    { name: 'City Harvest London', type: 'food', address: 'Distribution network', phone: '020 8537 7758', hours: 'Mon-Fri 8-5', dist: 'City-wide', url: 'https://www.cityharvest.org.uk' },
    { name: 'TfL Emergency Travel', type: 'transport', address: 'London Underground & Buses', phone: '0343 222 1234', hours: 'See emergency schedule', dist: 'City-wide', url: 'https://tfl.gov.uk' },
    { name: 'London Black Cabs', type: 'transport', address: 'City-wide hailing', phone: '020 7272 0272', hours: '24/7', dist: 'City-wide', url: '' },
    { name: 'London Ambulance Service', type: 'transport', address: 'Emergency', phone: '999', hours: '24/7', dist: 'Regional', url: 'https://www.londonambulance.nhs.uk' },
    { name: "St Thomas' Hospital A&E", type: 'medical', address: 'Westminster Bridge Rd SE1 7EH', phone: '020 7188 7188', hours: '24/7', dist: '1mi', url: 'https://www.guysandstthomas.nhs.uk' },
    { name: 'Royal London Hospital A&E', type: 'medical', address: 'Whitechapel Rd E1 1FR', phone: '020 7377 7000', hours: '24/7', dist: '2mi', url: 'https://www.bartshealth.nhs.uk' },
    { name: 'NHS 111 England', type: 'medical', address: 'Phone / online', phone: '111', hours: '24/7', dist: 'National', url: 'https://111.nhs.uk' },
    { name: 'Samaritans', type: 'medical', address: 'Phone / email', phone: '116 123', hours: '24/7 free', dist: 'National', url: 'https://www.samaritans.org' },
    { name: 'Salvation Army Clothing (London)', type: 'clothing', address: 'Multiple charity shops', phone: '020 7367 4500', hours: 'Varies', dist: 'City-wide', url: 'https://www.salvationarmy.org.uk' },
  ],
  manchester: [
    { name: 'Manchester City Council Emergency', type: 'shelter', address: 'Town Hall, Albert Square M2 5DB', phone: '0161 234 5000', hours: '24/7', dist: 'City-wide', url: 'https://www.manchester.gov.uk' },
    { name: 'Shelter Manchester', type: 'shelter', address: 'Manchester', phone: '0808 800 4444', hours: 'Mon-Fri 8-8', dist: 'City-wide', url: 'https://england.shelter.org.uk' },
    { name: 'Mustard Tree', type: 'shelter', address: '97-101 Oldham Rd M4 5BQ', phone: '0161 228 7331', hours: 'Mon-Fri 9-4:30', dist: '0.5mi', url: 'https://www.mustardtree.org.uk' },
    { name: 'Manchester Central Foodbank', type: 'food', address: 'Various locations', phone: '0161 834 9584', hours: 'Varies', dist: 'City-wide', url: 'https://manchestercentral.foodbank.org.uk' },
    { name: 'FareShare Greater Manchester', type: 'food', address: 'Distribution network', phone: '0161 223 8200', hours: 'Mon-Fri 8-5', dist: 'City-wide', url: 'https://fareshare.org.uk' },
    { name: 'TfGM Emergency Travel', type: 'transport', address: 'Metrolink & Buses', phone: '0161 244 1000', hours: 'Emergency schedule', dist: 'City-wide', url: 'https://tfgm.com' },
    { name: 'Manchester Royal Infirmary A&E', type: 'medical', address: 'Oxford Rd M13 9WL', phone: '0161 276 1234', hours: '24/7', dist: '1.5mi', url: 'https://mft.nhs.uk' },
    { name: 'NHS 111', type: 'medical', address: 'Phone / online', phone: '111', hours: '24/7', dist: 'National', url: 'https://111.nhs.uk' },
    { name: 'Samaritans Manchester', type: 'medical', address: 'Phone / email', phone: '116 123', hours: '24/7', dist: 'National', url: 'https://www.samaritans.org' },
    { name: 'Salvation Army Manchester', type: 'clothing', address: 'North West Division', phone: '0161 228 6929', hours: 'Mon-Sat 10-4', dist: 'City-wide', url: 'https://www.salvationarmy.org.uk' },
  ],
  birmingham: [
    { name: 'Birmingham City Council Emergency', type: 'shelter', address: 'Council House, Victoria Sq B1 1BB', phone: '0121 303 9999', hours: '24/7', dist: 'City-wide', url: 'https://www.birmingham.gov.uk' },
    { name: 'Shelter Birmingham', type: 'shelter', address: 'Birmingham', phone: '0808 800 4444', hours: 'Mon-Fri 8-8', dist: 'City-wide', url: 'https://england.shelter.org.uk' },
    { name: 'Birmingham Foodbank (Trussell)', type: 'food', address: 'Various locations', phone: '0121 328 1677', hours: 'Varies', dist: 'City-wide', url: 'https://birmingham.foodbank.org.uk' },
    { name: 'National Express Emergency', type: 'transport', address: 'City-wide buses', phone: '0121 254 7272', hours: 'Emergency schedule', dist: 'City-wide', url: 'https://nxbus.co.uk' },
    { name: 'Queen Elizabeth Hospital A&E', type: 'medical', address: 'Mindelsohn Way B15 2GW', phone: '0121 627 2000', hours: '24/7', dist: '2mi', url: 'https://www.uhb.nhs.uk' },
    { name: 'NHS 111', type: 'medical', address: 'Phone / online', phone: '111', hours: '24/7', dist: 'National', url: 'https://111.nhs.uk' },
    { name: 'Samaritans', type: 'medical', address: 'Phone / email', phone: '116 123', hours: '24/7', dist: 'National', url: 'https://www.samaritans.org' },
    { name: 'Salvation Army Birmingham', type: 'clothing', address: 'Multiple locations', phone: '0121 622 2461', hours: 'Mon-Sat 10-4', dist: 'City-wide', url: 'https://www.salvationarmy.org.uk' },
  ],
  leeds: [
    { name: 'Leeds City Council Emergency', type: 'shelter', address: 'Civic Hall, Calverley St LS1 1UR', phone: '0113 222 4444', hours: '24/7', dist: 'City-wide', url: 'https://www.leeds.gov.uk' },
    { name: 'Leeds Foodbank (Trussell)', type: 'food', address: 'Various locations', phone: '0113 264 4055', hours: 'Varies', dist: 'City-wide', url: 'https://leeds.foodbank.org.uk' },
    { name: 'First Leeds Buses Emergency', type: 'transport', address: 'City-wide', phone: '0113 245 7676', hours: 'Emergency schedule', dist: 'City-wide', url: 'https://www.firstbus.co.uk' },
    { name: 'Leeds General Infirmary A&E', type: 'medical', address: 'Great George St LS1 3EX', phone: '0113 243 2799', hours: '24/7', dist: '0.5mi', url: 'https://www.leedsth.nhs.uk' },
    { name: 'NHS 111', type: 'medical', address: 'Phone / online', phone: '111', hours: '24/7', dist: 'National', url: 'https://111.nhs.uk' },
    { name: 'Samaritans', type: 'medical', address: 'Phone / email', phone: '116 123', hours: '24/7', dist: 'National', url: 'https://www.samaritans.org' },
    { name: 'Salvation Army Leeds', type: 'clothing', address: 'Leeds area', phone: '0113 244 9524', hours: 'Mon-Sat 10-4', dist: 'City-wide', url: 'https://www.salvationarmy.org.uk' },
  ],
  cardiff: [
    { name: 'Cardiff Council Emergency', type: 'shelter', address: 'County Hall, Atlantic Wharf CF10 4UW', phone: '029 2087 2087', hours: '24/7', dist: 'City-wide', url: 'https://www.cardiff.gov.uk' },
    { name: 'Shelter Cymru Cardiff', type: 'shelter', address: 'Cardiff', phone: '0345 075 5005', hours: 'Mon-Fri 9-5', dist: 'City-wide', url: 'https://sheltercymru.org.uk' },
    { name: 'Cardiff Foodbank (Trussell)', type: 'food', address: 'Various locations', phone: '029 2037 3073', hours: 'Varies', dist: 'City-wide', url: 'https://cardiff.foodbank.org.uk' },
    { name: 'Cardiff Bus Emergency', type: 'transport', address: 'City-wide', phone: '029 2066 6444', hours: 'Emergency schedule', dist: 'City-wide', url: 'https://www.cardiffbus.com' },
    { name: 'University Hospital of Wales A&E', type: 'medical', address: 'Heath Park CF14 4XW', phone: '029 2074 7747', hours: '24/7', dist: '2mi', url: 'https://cavuhb.nhs.wales' },
    { name: 'NHS 111 Wales', type: 'medical', address: 'Phone / online', phone: '111', hours: '24/7', dist: 'National', url: 'https://111.wales.nhs.uk' },
    { name: 'Samaritans', type: 'medical', address: 'Phone / email', phone: '116 123', hours: '24/7', dist: 'National', url: 'https://www.samaritans.org' },
  ],
  belfast: [
    { name: 'Belfast City Council Emergency', type: 'shelter', address: 'City Hall, Donegall Sq BT1 5GS', phone: '028 9032 0202', hours: '24/7', dist: 'City-wide', url: 'https://www.belfastcity.gov.uk' },
    { name: 'Housing Executive NI', type: 'shelter', address: 'Multiple offices', phone: '03448 920 900', hours: 'Mon-Fri 8:30-5', dist: 'City-wide', url: 'https://www.nihe.gov.uk' },
    { name: 'Belfast Foodbank (Trussell)', type: 'food', address: 'Various locations', phone: '028 9024 5733', hours: 'Varies', dist: 'City-wide', url: 'https://belfast.foodbank.org.uk' },
    { name: 'Translink Emergency', type: 'transport', address: 'Metro & Buses', phone: '028 9066 6630', hours: 'Emergency schedule', dist: 'City-wide', url: 'https://www.translink.co.uk' },
    { name: 'Royal Victoria Hospital A&E', type: 'medical', address: 'Grosvenor Rd BT12 6BA', phone: '028 9024 0503', hours: '24/7', dist: '1mi', url: 'https://belfasttrust.hscni.net' },
    { name: 'NHS 111 (NI)', type: 'medical', address: 'Phone service', phone: '111', hours: '24/7', dist: 'National', url: '' },
    { name: 'Samaritans', type: 'medical', address: 'Phone / email', phone: '116 123', hours: '24/7', dist: 'National', url: 'https://www.samaritans.org' },
  ],
  inverness: [
    { name: 'Highland Council Emergency', type: 'shelter', address: 'Town House, High St IV1 1JJ', phone: '01349 886606', hours: '24/7', dist: 'Regional', url: 'https://www.highland.gov.uk' },
    { name: 'Salvation Army Inverness', type: 'shelter', address: '18 Denny St IV3 5LD', phone: '01463 233736', hours: '24/7', dist: '0.5mi', url: 'https://www.salvationarmy.org.uk' },
    { name: 'Highland Foodbank', type: 'food', address: 'Multiple locations', phone: '01463 236800', hours: 'Varies', dist: 'Regional', url: 'https://highland.foodbank.org.uk' },
    { name: 'Stagecoach Highlands Emergency', type: 'transport', address: 'Bus network', phone: '01463 233371', hours: 'Emergency schedule', dist: 'Regional', url: 'https://www.stagecoachbus.com' },
    { name: 'Raigmore Hospital A&E', type: 'medical', address: 'Old Perth Rd IV2 3UJ', phone: '01463 704000', hours: '24/7', dist: '1.5mi', url: 'https://www.nhshighland.scot.nhs.uk' },
    { name: 'NHS 24 Health Line', type: 'medical', address: 'Phone service', phone: '111', hours: '24/7', dist: 'National', url: 'https://www.nhs24.scot' },
    { name: 'Samaritans', type: 'medical', address: 'Phone / email', phone: '116 123', hours: '24/7', dist: 'National', url: 'https://www.samaritans.org' },
    { name: 'Blythswood Care Inverness', type: 'clothing', address: 'Highland area', phone: '01463 221011', hours: 'Mon-Fri 9-5', dist: 'Regional', url: 'https://www.blythswood.org' },
  ],
}

const SAFE_MEETING_PLACES = [
  'Local library or community centre',
  'Supermarket car park (daytime only)',
  'Police station front desk',
  'Hospital main entrance',
  'Council building reception',
  'High street with CCTV (well-lit)',
]

const INITIAL_POSTS: Post[] = [
  { id: 1, type: 'shelter', name: 'Verified Helper', description: 'Spare room for 2 adults. Warm, dry, WiFi. Verified through council scheme.', location: 'City Centre', time: '20 mins ago', verified: true, rating: 5, safe_meeting: 'Central Library' },
  { id: 2, type: 'transport', name: 'Verified Helper', description: '4x4 available for evacuation. Can carry 4 passengers + luggage. Background checked.', location: 'North District', time: '45 mins ago', verified: true, rating: 4, safe_meeting: 'Supermarket car park' },
  { id: 3, type: 'food', name: 'Community Kitchen', description: 'Hot meals for 20+ people. Halal, vegetarian and gluten-free options. Free.', location: 'City Centre', time: '1 hour ago', verified: true, rating: 5, safe_meeting: 'Town Square (public)' },
  { id: 4, type: 'clothing', name: 'Donation Hub', description: 'Dry clothes, blankets, coats, shoes — all sizes including children.', location: 'West Side', time: '1.5 hours ago', verified: false, rating: 4, safe_meeting: 'Community Centre' },
  { id: 5, type: 'medical', name: 'Volunteer First Aider', description: 'Qualified first aider with kit. Can attend nearby locations during daytime.', location: 'South District', time: '2 hours ago', verified: true, rating: 5, safe_meeting: 'Local Health Centre' },
]

/* Reverse geocode to get city name + country code, then match against known RESOURCES keys */
async function detectCityFromCoords(lat: number, lng: number): Promise<{key: string, countryCode: string}> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=10`,
      { headers: { 'Accept-Language': 'en' } }
    )
    if (!res.ok) return { key: 'generic', countryCode: '' }
    const data = await res.json()
    const addr = data.address || {}
    const countryCode = (addr.country_code || '').toUpperCase()
    // Try city, town, or county in that order
    const cityName = (addr.city || addr.town || addr.county || addr.state || '').toLowerCase().trim()
    // Check if we have specific resources for this city
    if (cityName && RESOURCES[cityName]) return { key: cityName, countryCode }
    // Partial match (e.g. "City of Edinburgh" → "edinburgh")
    for (const key of Object.keys(RESOURCES)) {
      if (key !== 'generic' && cityName.includes(key)) return { key, countryCode }
    }
    return { key: 'generic', countryCode }
  } catch {
    return { key: 'generic', countryCode: '' }
  }
}

export default function CommunityHelp({ onClose }: Props): JSX.Element {
  const lang = useLanguage()
  const { pushNotification } = useAlerts()
  const { location: loc, activeLocation } = useLocation()
  const { isAuthenticated } = useCitizenAuth()

  const [tab, setTab] = useState<'resources' | 'offer' | 'request' | 'network'>('resources')
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS)
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [consent, setConsent] = useState(false)
  const [actionConsent, setActionConsent] = useState(false)
  const [reported, setReported] = useState<Set<number>>(new Set())
  const [locationMode, setLocationMode] = useState<'auto' | 'manual' | null>(null)
  const [userCoords, setUserCoords] = useState<{lat: number; lng: number} | null>(null)
  const [detectedCity, setDetectedCity] = useState<string>('generic')
  const [detectedCountryCode, setDetectedCountryCode] = useState<string>('')
  const [findaHelplineUrl, setFindaHelplineUrl] = useState<string | null>(null)
  const [nearbyRadius, setNearbyRadius] = useState(5)
  const [submitting, setSubmitting] = useState(false)
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [postTranslations, setPostTranslations] = useState<Record<string, string>>({})

  const [manualLocation, setManualLocation] = useState('')
  const [locationSearching, setLocationSearching] = useState(false)
  const [displayLocation, setDisplayLocation] = useState('')

  // Helper to fetch with auth token
  const authFetch = useCallback(async (path: string, options: RequestInit = {}) => {
    const token = getCitizenToken()
    const headers: Record<string, string> = { ...(options.headers as Record<string,string> || {}) }
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json'
    const method = (options.method || 'GET').toUpperCase()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const csrfToken = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    }
    const res = await fetch(path, { ...options, headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }))
      throw new Error(typeof err.error === 'string' ? err.error : err.error?.message || err.message || `HTTP ${res.status}`)
    }
    return res.json()
  }, [])

  // Load community help offers/requests from backend on mount
  useEffect(() => {
    let cancelled = false
    const loadPosts = async () => {
      setLoadingPosts(true)
      try {
        const data = await authFetch('/api/community?status=active')
        if (!cancelled && Array.isArray(data)) {
          const apiPosts: Post[] = data.map((item: any) => ({
            id: item.id || Date.now(),
            type: item.category || 'shelter',
            name: item.citizen_id ? t('communityHelp.communityMember', lang) : t('communityHelp.anonymous', lang),
            description: item.description || item.title,
            location: item.location_text || 'Unknown',
            time: item.created_at ? new Date(item.created_at).toLocaleString() : 'Recently',
            verified: false,
            rating: undefined,
            safe_meeting: undefined,
            translationEligible: true,
          }))
          // Use API posts if available, fall back to seed data only when empty
          setPosts(apiPosts.length > 0 ? apiPosts : INITIAL_POSTS)
        }
      } catch {
        // Silently fall back to initial posts if API is unavailable
      } finally {
        if (!cancelled) setLoadingPosts(false)
      }
    }
    loadPosts()
    return () => { cancelled = true }
  }, [authFetch, lang])

  useEffect(() => {
    setPostTranslations({})
  }, [lang])

  useEffect(() => {
    if (lang === 'en') return

    const untranslated = posts
      .filter((post) => post.translationEligible && post.description && !postTranslations[post.description])
      .map((post) => post.description)

    if (untranslated.length === 0) return

    const batch = untranslated.slice(0, 20)
    let cancelled = false

    ;(async () => {
      try {
        const translatedByText = await buildTranslationMap(batch, 'auto', lang)
        if (cancelled || Object.keys(translatedByText).length === 0) return
        setPostTranslations((prev) => ({ ...prev, ...translatedByText }))
      } catch {
        // Keep original content if translation fails.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [lang, posts, postTranslations])

  // Offer/request form state
  const [oType, setOType] = useState('')
  const [oDesc, setODesc] = useState('')
  const [oLoc, setOLoc] = useState('')
  const [oSafeMeeting, setOSafeMeeting] = useState('')
  const [oVerify, setOVerify] = useState(false) // user confirms they're real

  const [rType, setRType] = useState('')
  const [rDesc, setRDesc] = useState('')
  const [rLoc, setRLoc] = useState('')
  const [rUrgent, setRUrgent] = useState(false)
  const [rPeople, setRPeople] = useState('1')

  // Modal state
  const [showVerifyModal, setShowVerifyModal] = useState(false)
  const [verifyName, setVerifyName] = useState('')
  const [verifyEmail, setVerifyEmail] = useState('')
  const [verifyArea, setVerifyArea] = useState('')
  const [verifyRole, setVerifyRole] = useState('')
  const [verifySubmitted, setVerifySubmitted] = useState(false)
  const [infoPost, setInfoPost] = useState<Post | null>(null)
  const [contactPost, setContactPost] = useState<Post | null>(null)
  const [contactMsg, setContactMsg] = useState('')
  const [contactSent, setContactSent] = useState(false)

  const locationKey = (detectedCity && detectedCity !== 'generic') ? detectedCity : null
  const countryResources = useMemo<Resource[]>(() => {
    const emer = getEmergencyInfo(detectedCountryCode || 'XX')
    return [
      { name: 'Emergency Services', type: 'medical', address: `Dial ${emer.universal}`, phone: emer.universal, hours: '24/7', dist: 'Nearest', url: '' },
      { name: 'Police', type: 'shelter', address: 'Nearest police station', phone: emer.police, hours: '24/7', dist: 'Nearest', url: '' },
      { name: 'Ambulance / EMS', type: 'medical', address: 'Emergency dispatch', phone: emer.ambulance, hours: '24/7', dist: 'Nearest', url: '' },
      { name: 'Fire & Rescue', type: 'shelter', address: 'Nearest station', phone: emer.fire, hours: '24/7', dist: 'Nearest', url: '' },
      ...(emer.extras || []).map(e => ({ name: e.name, type: 'medical', address: e.desc, phone: e.number, hours: '24/7', dist: 'National', url: '' } as Resource)),
      ...RESOURCES.generic,
    ]
  }, [detectedCountryCode])

  // Check findahelpline.com for the detected country and store the URL if a page exists
  useEffect(() => {
    if (!detectedCountryCode) { setFindaHelplineUrl(null); return }
    const cc = detectedCountryCode.toLowerCase()
    const url = `https://findahelpline.com/countries/${cc}`
    fetch(url, { method: 'HEAD' })
      .then(r => setFindaHelplineUrl(r.ok ? url : null))
      .catch(() => setFindaHelplineUrl(null))
  }, [detectedCountryCode])

  const resources = (locationKey && RESOURCES[locationKey]) ? RESOURCES[locationKey] : countryResources
  const filtered = (filter === 'all' ? resources : resources.filter(r => r.type === filter))
    .filter(r => !searchTerm || r.name.toLowerCase().includes(searchTerm.toLowerCase()) || r.address.toLowerCase().includes(searchTerm.toLowerCase()))

  const filteredPosts = (filter === 'all' ? posts : posts.filter(p => p.type === filter))
    .filter((p) => !searchTerm || (postTranslations[p.description] || p.description).toLowerCase().includes(searchTerm.toLowerCase()))

  const GPS_OPTS: PositionOptions = { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }

  const gps = (set: (v: string) => void) => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        p => {
          set(`${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`)
          setUserCoords({ lat: p.coords.latitude, lng: p.coords.longitude })
          detectCityFromCoords(p.coords.latitude, p.coords.longitude).then(({key, countryCode}) => {
            setDetectedCity(key)
            setDetectedCountryCode(countryCode)
          })
          pushNotification('Location detected — showing approximate area only', 'success')
        },
        (err) => {
          const msg = err.code === 1
            ? 'Location permission denied — enable in browser settings and try again'
            : err.code === 3
            ? 'Location timed out — check GPS signal and try again'
            : 'Location unavailable — type your approximate area manually'
          pushNotification(msg, 'warning')
        },
        GPS_OPTS
      )
    } else {
      pushNotification('Geolocation is not supported in this browser', 'warning')
    }
  }

  const mountAutoDetected = useRef(false)

  const autoDetect = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (p) => {
          setUserCoords({ lat: p.coords.latitude, lng: p.coords.longitude })
          setLocationMode('auto')
          const {key: city, countryCode: detectedCC} = await detectCityFromCoords(p.coords.latitude, p.coords.longitude)
          setDetectedCity(city)
          setDetectedCountryCode(detectedCC)
          const cityName = city === 'generic' ? '' : city.charAt(0).toUpperCase() + city.slice(1)
          setDisplayLocation(cityName || detectedCC)
          pushNotification(`Location detected — showing resources near ${cityName || detectedCC}`, 'success')
        },
        (err) => {
          setLocationMode('manual')
          const msg = err.code === 1
            ? 'Location permission denied — enable in browser settings'
            : err.code === 3
            ? 'Location timed out — check GPS/location services are enabled'
            : 'Could not detect location — showing default area resources'
          pushNotification(msg, 'warning')
        },
        GPS_OPTS
      )
    } else {
      setLocationMode('manual')
      pushNotification('Geolocation not supported in this browser', 'warning')
    }
  }

  // Auto-detect location on mount — guard prevents StrictMode double-fire
  useEffect(() => {
    if (mountAutoDetected.current) return
    mountAutoDetected.current = true
    autoDetect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Search by city name, country, or postcode using Nominatim geocoding
  const searchLocation = async (query: string) => {
    if (!query.trim() || query.trim().length < 2) return
    setLocationSearching(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query.trim())}&format=json&addressdetails=1&limit=1`,
        { headers: { 'Accept-Language': 'en' } }
      )
      if (!res.ok) throw new Error('Geocoding failed')
      const results = await res.json()
      if (results.length > 0) {
        const { lat, lon, display_name, address } = results[0]
        setUserCoords({ lat: parseFloat(lat), lng: parseFloat(lon) })
        setLocationMode('manual')
        const {key: city, countryCode: detectedCC} = await detectCityFromCoords(parseFloat(lat), parseFloat(lon))
        setDetectedCity(city)
        setDetectedCountryCode(detectedCC)
        const label = address?.city || address?.town || address?.county || address?.state || address?.country || display_name?.split(',')[0] || query
        setDisplayLocation(label)
        pushNotification(`Showing resources near ${label}`, 'success')
      } else {
        pushNotification(`No results found for "${query}". Try a city name or postcode.`, 'warning')
      }
    } catch {
      pushNotification('Location search failed. Please try again.', 'warning')
    } finally {
      setLocationSearching(false)
    }
  }

  const doOffer = async () => {
    if (!actionConsent) { pushNotification('Please accept the safety agreement first.', 'warning'); return }
    if (!oType || !oDesc || oDesc.length < 10) { pushNotification('Select a type and add a description (min 10 chars).', 'warning'); return }
    if (!oSafeMeeting) { pushNotification('Please specify a safe public meeting place.', 'warning'); return }

    setSubmitting(true)
    try {
      const result = await authFetch('/api/community', {
        method: 'POST',
        body: JSON.stringify({
          type: 'offer',
          category: oType,
          title: `${COMMUNITY_HELP_TYPES.find(t => t.key === oType)?.label || oType} offer`,
          description: oDesc,
          location_text: oLoc || loc.name,
          location_lat: userCoords?.lat || null,
          location_lng: userCoords?.lng || null,
          consent_given: true,
        }),
      })

      // Add to local list immediately for responsiveness
      setPosts(p => [{
        id: result?.id || Date.now(), type: oType, name: oVerify ? t('communityHelp.verifiedHelperChecked', lang) : t('communityHelp.anonymousHelper', lang),
        description: oDesc, location: oLoc || loc.name, time: 'Just now',
        verified: oVerify, rating: undefined, safe_meeting: oSafeMeeting, translationEligible: true
      }, ...p])
      pushNotification('Offer posted successfully! It will be visible to the community.', 'success')
      setOType(''); setODesc(''); setOLoc(''); setOSafeMeeting(''); setOVerify(false)
    } catch (err: any) {
      pushNotification(err.message || 'Failed to post offer. Please try again.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const doRequest = async () => {
    if (!actionConsent) { pushNotification('Please accept the safety agreement first.', 'warning'); return }
    if (!rType) { pushNotification('Select what help you need.', 'warning'); return }

    setSubmitting(true)
    try {
      await authFetch('/api/community', {
        method: 'POST',
        body: JSON.stringify({
          type: 'request',
          category: rType,
          title: `${rUrgent ? 'URGENT: ' : ''}${COMMUNITY_HELP_TYPES.find(t => t.key === rType)?.label || rType} needed`,
          description: rDesc || `Need ${COMMUNITY_HELP_TYPES.find(t => t.key === rType)?.label || 'help'} for ${rPeople} ${rPeople === '1' ? 'person' : 'people'}`,
          location_text: rLoc || loc.name,
          location_lat: userCoords?.lat || null,
          location_lng: userCoords?.lng || null,
          capacity: parseInt(rPeople) || 1,
          consent_given: true,
        }),
      })

      pushNotification(
        rUrgent ? 'Urgent request sent — nearest available volunteers will be notified.' : 'Request submitted — nearby helpers will be notified.',
        rUrgent ? 'warning' : 'success'
      )
      setRType(''); setRDesc(''); setRLoc(''); setRUrgent(false); setRPeople('1')
    } catch (err: any) {
      pushNotification(err.message || 'Failed to submit request. Please try again.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const TypeIcon = ({ type, className }: { type: string; className?: string }) => {
    const I = TYPE_ICONS[type] || HelpCircle
    return <I className={className || 'w-3.5 h-3.5'} />
  }

  const Stars = ({ n }: { n?: number }) => n ? (
    <span className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => <Star key={i} className={`w-2.5 h-2.5 ${i <= n ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300 dark:text-gray-300'}`} />)}
    </span>
  ) : null

  // Location detection step
  if (!consent) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 z-50" role="dialog" aria-modal="true">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-5 animate-fade-in">
          <div className="text-center mb-4">
            <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Heart className="w-7 h-7 text-green-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('communityHelp.title', lang)} {t('communityHelp.network', lang)}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-300 mt-1">{t('communityHelp.subtitle', lang)}</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3.5 mb-4">
            <div className="flex items-start gap-2 mb-2">
              <Shield className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <h4 className="font-semibold text-sm">{t('communityHelp.safetyFirst', lang)}</h4>
            </div>
            <div className="text-[11px] text-amber-800 dark:text-amber-300 space-y-1">
              {['communityHelp.safetyAnonymous', 'communityHelp.safetyReviewed', 'communityHelp.safetyLocation', 'communityHelp.safetyNoAddress', 'communityHelp.safetyMeetPublic', 'communityHelp.safetyReport', 'communityHelp.safetyCall999'].map(key => (
                <p key={key} className="flex items-center gap-1.5"><CheckIcon /> {t(key, lang)}</p>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={onClose} className="order-last text-xs text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300 text-center py-1">{t('common.cancel', lang)}</button>
            <button onClick={() => setConsent(true)} className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2">
              <Shield className="w-4 h-4" /> {t('communityHelp.understand', lang)}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-3 z-50" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[92vh] overflow-y-auto animate-fade-in">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white p-4 rounded-t-2xl flex items-center justify-between sticky top-0 z-10">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2"><Heart className="w-4 h-4" /> {t('communityHelp.title', lang)}</h2>
            <p className="text-[10px] text-green-100 mt-0.5 flex items-center gap-1">
              <MapPin className="w-2.5 h-2.5" /> {displayLocation || loc.name}
              {userCoords && <span className="bg-green-500/50 px-1.5 py-0.5 rounded-full ml-1 flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> {t('communityHelp.gpsActive', lang)}</span>}
            </p>
          </div>
          <button onClick={onClose} className="hover:bg-white/20 p-2 rounded-lg transition-colors" aria-label={t('common.close', lang)}><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4">
          {/* Tabs */}
          <div className="grid grid-cols-4 gap-1 mb-3">
            {([
              ['resources', t('communityHelp.resources', lang), Navigation, 'bg-blue-600'],
              ['offer',     t('communityHelp.offer', lang),     Heart,       'bg-green-600'],
              ['request',  t('communityHelp.needHelp', lang),  HelpCircle,  'bg-red-600'],
              ['network',  t('communityHelp.network', lang),    Globe,       'bg-amber-600'],
            ] as const).map(([id, label, Icon, color]) => {
              const locked = !isAuthenticated && id !== 'resources'
              return (
                <button key={id} onClick={() => setTab(id as any)}
                  className={`py-2 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[9px] sm:text-[10px] font-semibold transition-all relative ${tab === id ? (locked ? 'bg-gray-500 text-white shadow-md' : `${color} text-white shadow-md`) : locked ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-300 hover:bg-gray-200' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>
                  <div className="relative">
                    <Icon className="w-3.5 h-3.5" />
                    {locked && <Lock className="w-2 h-2 absolute -top-1 -right-1.5 text-current opacity-80" />}
                  </div>
                  <span className="leading-tight text-center">{label}</span>
                </button>
              )
            })}
          </div>

          {/* Search + filter row */}
          <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
            <div className="flex-1 min-w-[130px] flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-xl text-sm">
              <Search className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300 flex-shrink-0" />
              <input className="flex-1 bg-transparent text-xs outline-none placeholder-gray-400 min-w-0" placeholder={t('communityHelp.searchPlaceholder', lang)} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <button onClick={() => setFilter('all')} className={`px-2.5 py-1.5 rounded-xl text-[10px] font-medium flex-shrink-0 transition-colors ${filter === 'all' ? 'bg-green-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600'}`}>{t('communityHelp.all', lang)}</button>
            {COMMUNITY_HELP_TYPES.map(t => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className={`px-2.5 py-1.5 rounded-xl text-[10px] font-medium flex-shrink-0 flex items-center gap-0.5 transition-colors ${filter === t.key ? 'bg-green-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600'}`}>
                <TypeIcon type={t.key} className="w-3 h-3" />
              </button>
            ))}
          </div>

          {/* GUEST LOCKED TAB CTAs*/}
          {!isAuthenticated && tab === 'offer' && (
            <div className="space-y-4 py-4">
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Heart className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">{t('communityHelp.offerHelpTitle', lang)}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-300 max-w-sm mx-auto">{t('communityHelp.offerHelpDesc', lang)}</p>
              </div>
              <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
                <div className="space-y-2 text-[11px] text-green-800 dark:text-green-300">
                  {['communityHelp.offerBullet1', 'communityHelp.offerBullet2', 'communityHelp.offerBullet3', 'communityHelp.offerBullet4', 'communityHelp.offerBullet5'].map(key => (
                    <p key={key} className="flex items-center gap-2"><CheckIcon /> {t(key, lang)}</p>
                  ))}
                </div>
              </div>
              <a href="/citizen/login" className="block w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-semibold text-sm text-center transition-colors shadow-md">
                {t('communityHelp.signInOffer', lang)}
              </a>
              <p className="text-[10px] text-gray-400 dark:text-gray-300 text-center">{t('communityHelp.noAccount', lang)} <a href="/citizen/login" className="text-green-600 hover:underline font-medium">{t('communityHelp.registerFree', lang)}</a></p>
            </div>
          )}

          {!isAuthenticated && tab === 'request' && (
            <div className="space-y-4 py-4">
              <div className="text-center">
                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <HelpCircle className="w-8 h-8 text-red-600" />
                </div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">{t('communityHelp.requestTitle', lang)}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-300 max-w-sm mx-auto">{t('communityHelp.requestDesc', lang)}</p>
              </div>
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                <div className="space-y-2 text-[11px] text-red-900 dark:text-red-300">
                  {['communityHelp.requestBullet1', 'communityHelp.requestBullet2', 'communityHelp.requestBullet3', 'communityHelp.requestBullet4', 'communityHelp.requestBullet5'].map(key => (
                    <p key={key} className="flex items-center gap-2"><CheckIcon /> {t(key, lang)}</p>
                  ))}
                </div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-800 dark:text-amber-300">{t('communityHelp.emergencyBoardWarning', lang)}</p>
              </div>
              <a href="/citizen/login" className="block w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-semibold text-sm text-center transition-colors shadow-md">
                {t('communityHelp.signInRequest', lang)}
              </a>
              <p className="text-[10px] text-gray-400 dark:text-gray-300 text-center">{t('communityHelp.noAccount', lang)} <a href="/citizen/login" className="text-red-600 hover:underline font-medium">{t('communityHelp.registerFree', lang)}</a></p>
            </div>
          )}

          {!isAuthenticated && tab === 'network' && (
            <div className="space-y-4 py-4">
              <div className="text-center">
                <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Globe className="w-8 h-8 text-amber-600" />
                </div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">{t('communityHelp.joinNetworkTitle', lang)}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-300 max-w-sm mx-auto">{t('communityHelp.joinNetworkDesc', lang)}</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4">
                <div className="space-y-2 text-[11px] text-amber-800 dark:text-amber-300">
                  {['communityHelp.networkBullet1', 'communityHelp.networkBullet2', 'communityHelp.networkBullet3', 'communityHelp.networkBullet4', 'communityHelp.networkBullet5'].map(key => (
                    <p key={key} className="flex items-center gap-2"><CheckIcon /> {t(key, lang)}</p>
                  ))}
                </div>
              </div>
              <a href="/citizen/login" className="block w-full bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-xl font-semibold text-sm text-center transition-colors shadow-md">
                {t('communityHelp.signInNetwork', lang)}
              </a>
              <p className="text-[10px] text-gray-400 dark:text-gray-300 text-center">{t('communityHelp.noAccount', lang)} <a href="/citizen/login" className="text-amber-600 hover:underline font-medium">{t('communityHelp.registerFree', lang)}</a></p>
            </div>
          )}

          {/* RESOURCES TAB*/}
          {tab === 'resources' && (
            <div className="space-y-2">
              {/* Location search bar */}
              <div className="flex gap-1.5">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-xl text-sm">
                  <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <input
                    className="flex-1 bg-transparent text-xs outline-none placeholder-gray-400 min-w-0"
                    placeholder="Search by city, country, or postcode..."
                    value={manualLocation}
                    onChange={e => setManualLocation(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') searchLocation(manualLocation) }}
                  />
                  {locationSearching && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />}
                </div>
                <button onClick={() => searchLocation(manualLocation)} disabled={locationSearching || !manualLocation.trim()} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-[10px] font-semibold transition-colors flex-shrink-0">
                  <Search className="w-3.5 h-3.5" />
                </button>
                <button onClick={autoDetect} className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-[10px] font-semibold transition-colors flex-shrink-0" title="Use GPS">
                  <Crosshair className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-1">
                <p className="text-[10px] text-gray-500 dark:text-gray-300">{filtered.length} {t('communityHelp.resourcesNear', lang)} <strong>{displayLocation || loc.name}</strong></p>
              </div>
              <div className="max-h-[58vh] overflow-y-auto space-y-2 pr-1">
                {filtered.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 text-center animate-enter">
                    <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                      <Search className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                    </div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{t('communityHelp.noResourcesMatch', lang)}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Try a different search term or clear your filter</p>
                  </div>
                )}
                {findaHelplineUrl && (
                  <a href={findaHelplineUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 rounded-xl hover:bg-purple-100 dark:hover:bg-purple-950/30 transition-colors group">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center flex-shrink-0">
                      <Heart className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-purple-900 dark:text-purple-200">Find verified mental health &amp; crisis helplines</p>
                      <p className="text-[10px] text-purple-600 dark:text-purple-400">findahelpline.com — free, verified support lines for {detectedCountryCode.toUpperCase()}</p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-purple-400 group-hover:text-purple-600 flex-shrink-0" />
                  </a>
                )}
                {filtered.map((r, i) => (
                  <div key={i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 hover:shadow-md transition-all group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded-full font-medium">
                            <TypeIcon type={r.type} className="w-2.5 h-2.5" />
                            {COMMUNITY_HELP_TYPES.find(t => t.key === r.type)?.label}
                          </span>
                          <span className="text-[10px] text-gray-500 dark:text-gray-300">{r.dist}</span>
                        </div>
                        <h4 className="font-semibold text-xs text-gray-900 dark:text-white group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors">{r.name}</h4>
                        <p className="text-[10px] text-gray-600 dark:text-gray-300 flex items-center gap-1 mt-0.5"><MapPin className="w-2.5 h-2.5 flex-shrink-0" /> {r.address}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500 dark:text-gray-300">
                          <span className="flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" /> {r.phone}</span>
                          <span className="flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" /> {r.hours}</span>
                        </div>
                      </div>
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noopener noreferrer"
                          className="p-2 bg-gray-100 dark:bg-gray-700 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors flex-shrink-0" title={t('communityHelp.visitWebsite', lang)}>
                          <ExternalLink className="w-3.5 h-3.5 text-gray-500 dark:text-gray-300 hover:text-green-600 dark:hover:text-green-400" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* OFFER HELP TAB*/}
          {isAuthenticated && tab === 'offer' && (
            <div className="space-y-3">
              {!actionConsent ? (
                <div className="p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl">
                  <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-600" /> {t('communityHelp.offerAgreement', lang)}</h4>
                  <div className="text-[11px] text-green-800 dark:text-green-300 space-y-1 mb-3">
                    {['communityHelp.agreeOffer1', 'communityHelp.agreeOffer2', 'communityHelp.agreeOffer3', 'communityHelp.agreeOffer4', 'communityHelp.agreeOffer5', 'communityHelp.agreeOffer6'].map(key => (
                      <p key={key} className="flex items-center gap-1.5"><CheckIcon /> {t(key, lang)}</p>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setActionConsent(true)} className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-xl text-xs font-semibold transition-colors">{t('communityHelp.agreePostOffer', lang)}</button>
                    <button onClick={() => setTab('resources')} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-xl text-xs font-semibold transition-colors">{t('common.back', lang)}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="p-2.5 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl">
                    <p className="text-[10px] text-green-800 dark:text-green-300 flex items-center gap-1"><Lock className="w-3 h-3" /> <strong>{t('communityHelp.privateNotice', lang)}</strong></p>
                  </div>

                  {/* Type selector */}
                  <div>
                    <label className="text-xs font-semibold">{t('communityHelp.whatCanYouOffer', lang)} <span className="text-red-500">*</span></label>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 mt-1.5" role="radiogroup" aria-required="true">
                      {COMMUNITY_HELP_TYPES.map(t => (
                        <button key={t.key} onClick={() => setOType(t.key)} role="radio" aria-checked={oType === t.key}
                          className={`p-2 border-2 rounded-xl text-center transition-all ${oType === t.key ? 'border-green-500 bg-green-50 dark:bg-green-950/20 scale-105' : 'border-gray-200 dark:border-gray-700 hover:border-green-300'}`}>
                          <TypeIcon type={t.key} className={`w-5 h-5 mx-auto ${oType === t.key ? 'text-green-600' : 'text-gray-400 dark:text-gray-300'}`} />
                          <p className="text-[9px] font-medium mt-0.5 truncate">{t.label}</p>
                        </button>
                      ))}
                    </div>
                    {!oType && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">{t('communityHelp.selectTypeRequired', lang) || 'Please select a type'}</p>}
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-xs font-semibold">{t('common.description', lang)} <span className="text-red-500">*</span> <span className="text-gray-400 dark:text-gray-300 font-normal">{t('communityHelp.descriptionSublabel', lang)}</span></label>
                    <textarea 
                      className={`w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border min-h-[80px] resize-none transition-colors ${oDesc.length > 0 && oDesc.length < 10 ? 'border-amber-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30' : 'border-gray-200 dark:border-gray-700'}`}
                      placeholder={t('communityHelp.descriptionPlaceholder', lang)} 
                      value={oDesc} 
                      onChange={e => setODesc(e.target.value)}
                      aria-required="true"
                      aria-invalid={oDesc.length > 0 && oDesc.length < 10}
                    />
                    <div className="flex justify-between mt-0.5">
                      <p className={`text-[9px] ${oDesc.length > 0 && oDesc.length < 10 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-400 dark:text-gray-300'}`}>
                        {oDesc.length > 0 && oDesc.length < 10 ? `${10 - oDesc.length} more chars needed` : `${oDesc.length}/200 ${t('communityHelp.charsCount', lang)}`}
                      </p>
                      {oDesc.length >= 10 && <p className="text-[9px] text-green-600 dark:text-green-400 font-medium">✓ Valid</p>}
                    </div>
                  </div>

                  {/* Approximate area */}
                  <div>
                    <label className="text-xs font-semibold">{t('communityHelp.approximateArea', lang)} <span className="text-gray-400 dark:text-gray-300 font-normal">{t('communityHelp.notExactAddress', lang)}</span></label>
                    <div className="flex gap-1.5 mt-1">
                      <input className="flex-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" placeholder={t('communityHelp.areaPlaceholder', lang)} value={oLoc} onChange={e => setOLoc(e.target.value)} />
                      <button onClick={() => gps(setOLoc)} className="px-3 py-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-700 rounded-xl text-[10px] font-medium flex items-center gap-1 transition-colors hover:bg-blue-100">
                        <Crosshair className="w-3.5 h-3.5 text-blue-500" /> GPS
                      </button>
                    </div>
                  </div>

                  {/* Safe meeting place */}
                  <div>
                    <label className="text-xs font-semibold flex items-center gap-1.5"><Lock className="w-3 h-3 text-green-600" /> {t('communityHelp.safeMeetingPlace', lang)} <span className="text-red-500">*</span></label>
                    <select 
                      className={`w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border transition-colors ${!oSafeMeeting ? 'border-gray-200 dark:border-gray-700' : 'border-green-400'}`}
                      value={oSafeMeeting} 
                      onChange={e => setOSafeMeeting(e.target.value)}
                      aria-required="true"
                    >
                      <option value="">{t('communityHelp.selectMeetingPlace', lang)}</option>
                      {SAFE_MEETING_PLACES.map(p => <option key={p} value={p}>{p}</option>)}
                      <option value="other">{t('communityHelp.otherTypeBelow', lang)}</option>
                    </select>
                    {!oSafeMeeting && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">{t('communityHelp.safeMeetingRequired', lang) || 'Required for safety'}</p>}
                    {oSafeMeeting === 'other' && (
                      <input className="w-full mt-1.5 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" placeholder={t('communityHelp.specifyLocation', lang)} onChange={e => setOSafeMeeting(e.target.value === 'other' ? '' : e.target.value)} />
                    )}
                  </div>

                  {/* Identity verification option */}
                  <label className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-700 rounded-xl cursor-pointer">
                    <input type="checkbox" checked={oVerify} onChange={e => setOVerify(e.target.checked)} className="w-4 h-4 rounded border-blue-300 text-blue-600" />
                    <div>
                      <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1"><UserCheck className="w-3.5 h-3.5" /> {t('communityHelp.requestVerifiedBadge', lang)}</p>
                      <p className="text-[10px] text-blue-700 dark:text-blue-400 mt-0.5">{t('communityHelp.verifiedBadgeDesc', lang)}</p>
                    </div>
                  </label>

                  <button 
                    onClick={doOffer} 
                    disabled={submitting || !oType || !oDesc || oDesc.length < 10 || !oSafeMeeting} 
                    className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors shadow-md"
                    title={!oType || !oDesc || oDesc.length < 10 || !oSafeMeeting ? 'Complete all required fields' : ''}
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Heart className="w-4 h-4" />} {submitting ? t('communityHelp.posting', lang) : t('communityHelp.postOfferBtn', lang)}
                  </button>
                </>
              )}

              {/* Existing posts */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-2">
                <h4 className="font-semibold text-xs mb-2 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-green-500" /> {t('communityHelp.communityOffers', lang)} ({filteredPosts.length})</h4>
                <PostList posts={filteredPosts} postTranslations={postTranslations} reported={reported} setReported={setReported} pushNotification={pushNotification} TypeIcon={TypeIcon} Stars={Stars} />
              </div>
            </div>
          )}

          {/* REQUEST HELP TAB*/}
          {isAuthenticated && tab === 'request' && (
            <div className="space-y-3">
              {!actionConsent ? (
                <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl">
                  <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5"><Shield className="w-4 h-4 text-red-600" /> {t('communityHelp.requestAgreement', lang)}</h4>
                  <div className="text-[11px] text-red-900 dark:text-red-300 space-y-1 mb-3">
                    {['communityHelp.agreeReq1', 'communityHelp.agreeReq2', 'communityHelp.agreeReq3', 'communityHelp.agreeReq4', 'communityHelp.agreeReq5', 'communityHelp.agreeReq6'].map(key => (
                      <p key={key} className="flex items-center gap-1.5"><CheckIcon /> {t(key, lang)}</p>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setActionConsent(true)} className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl text-xs font-semibold transition-colors">{t('communityHelp.agreeRequestHelp', lang)}</button>
                    <button onClick={() => setTab('resources')} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-xl text-xs font-semibold transition-colors">{t('common.back', lang)}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="p-2.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-[10px] text-red-800 dark:text-red-300"><strong>{t('communityHelp.emergencyCall', lang)}</strong></p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold">{t('communityHelp.whatDoYouNeed', lang)} <span className="text-red-500">*</span></label>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 mt-1.5" role="radiogroup" aria-required="true">
                      {COMMUNITY_HELP_TYPES.map(t => (
                        <button key={t.key} onClick={() => setRType(t.key)} role="radio" aria-checked={rType === t.key}
                          className={`p-2 border-2 rounded-xl text-center transition-all ${rType === t.key ? 'border-red-500 bg-red-50 dark:bg-red-950/20 scale-105' : 'border-gray-200 dark:border-gray-700 hover:border-red-300'}`}>
                          <TypeIcon type={t.key} className={`w-5 h-5 mx-auto ${rType === t.key ? 'text-red-600' : 'text-gray-400 dark:text-gray-300'}`} />
                          <p className="text-[9px] font-medium mt-0.5 truncate">{t.label}</p>
                        </button>
                      ))}
                    </div>
                    {!rType && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">{t('communityHelp.selectTypeRequired', lang) || 'Please select what you need'}</p>}
                  </div>

                  <div>
                    <label className="text-xs font-semibold">{t('common.details', lang)} <span className="text-gray-400 dark:text-gray-300 font-normal">{t('communityHelp.detailsSublabel', lang)}</span></label>
                    <textarea className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 min-h-[70px] resize-none" placeholder={t('communityHelp.detailsPlaceholder', lang)} value={rDesc} onChange={e => setRDesc(e.target.value)} />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-semibold">{t('communityHelp.numPeople', lang)}</label>
                      <select className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" value={rPeople} onChange={e => setRPeople(e.target.value)}>
                        {['1','2','3','4','5','6+'].map(n => <option key={n} value={n}>{n} {n === '1' ? 'person' : 'people'}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold">{t('communityHelp.approximateArea', lang)}</label>
                      <div className="flex gap-1 mt-1">
                        <input className="flex-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" placeholder={t('communityHelp.areaOrPostcode', lang)} value={rLoc} onChange={e => setRLoc(e.target.value)} />
                        <button onClick={() => gps(setRLoc)} className="px-2 py-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-700 rounded-xl hover:bg-blue-100 transition-colors">
                          <Crosshair className="w-3 h-3 text-blue-500" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <label className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-700 rounded-xl cursor-pointer">
                    <input type="checkbox" checked={rUrgent} onChange={e => setRUrgent(e.target.checked)} className="w-4 h-4 rounded border-red-300 text-red-600" />
                    <div>
                      <p className="text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {t('communityHelp.markUrgent', lang)}</p>
                      <p className="text-[10px] text-red-600 dark:text-red-400">{t('communityHelp.urgentDesc', lang)}</p>
                    </div>
                  </label>

                  <button 
                    onClick={doRequest} 
                    disabled={submitting || !rType} 
                    className={`w-full ${rUrgent ? 'bg-red-700 hover:bg-red-800' : 'bg-red-600 hover:bg-red-700'} disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors shadow-md`}
                    title={!rType ? 'Select what you need first' : ''}
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : rUrgent ? <AlertTriangle className="w-4 h-4" /> : <HelpCircle className="w-4 h-4" />} {submitting ? t('common.submitting', lang) : rUrgent ? t('communityHelp.sendUrgent', lang) : t('communityHelp.submitRequest', lang)}
                  </button>
                </>
              )}
            </div>
          )}

          {/* NETWORK TAB*/}
          {isAuthenticated && tab === 'network' && (
            <div className="space-y-3">
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3.5">
                <h4 className="font-bold text-sm flex items-center gap-2 mb-2"><UserCheck className="w-4 h-4 text-amber-600" /> {t('communityHelp.verifiedNetwork', lang)}</h4>
                <p className="text-[11px] text-amber-800 dark:text-amber-300">{t('communityHelp.verifiedNetworkDesc', lang)}</p>
              </div>
              <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
                {filteredPosts.filter(p => p.verified).map(p => (
                  <div key={p.id} className="bg-white dark:bg-gray-800 border-2 border-amber-200 dark:border-amber-700 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                            <TypeIcon type={p.type} className="w-2.5 h-2.5" /> {COMMUNITY_HELP_TYPES.find(t => t.key === p.type)?.label}
                          </span>
                          {p.verified && <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-0.5"><UserCheck className="w-2.5 h-2.5" /> {t('communityHelp.verified', lang)}</span>}
                          <Stars n={p.rating} />
                        </div>
                        <p className="text-xs">{postTranslations[p.description] || p.description}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-1 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {p.location}</p>
                        {p.safe_meeting && (
                          <p className="text-[10px] text-green-700 dark:text-green-400 mt-0.5 flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> {t('communityHelp.meetLabel', lang)} {p.safe_meeting}</p>
                        )}
                      </div>
                      <button onClick={() => { setReported(s => new Set([...s, p.id])); pushNotification('Report received. Our team will review this listing.', 'info') }} disabled={reported.has(p.id)} className="text-gray-300 dark:text-gray-300 hover:text-red-500 dark:hover:text-red-400 p-1 transition-colors flex-shrink-0" title={t('communityHelp.reportListing', lang)}>
                        <Flag className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setContactSent(false); setContactMsg(''); setContactPost(p) }} className="flex-1 bg-green-50 dark:bg-green-950/20 hover:bg-green-100 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-300 py-1.5 rounded-lg text-[10px] font-semibold transition-colors flex items-center justify-center gap-1">
                        <Lock className="w-3 h-3" /> {t('communityHelp.requestSecureContact', lang)}
                      </button>
                      <button onClick={() => setInfoPost(p)} className="flex-1 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 border border-gray-200 dark:border-gray-600 py-1.5 rounded-lg text-[10px] font-semibold transition-colors flex items-center justify-center gap-1">
                        <Info className="w-3 h-3" /> {t('communityHelp.moreInfo', lang)}
                      </button>
                    </div>
                  </div>
                ))}
                {filteredPosts.filter(p => p.verified).length === 0 && (
                  <div className="text-center py-8">
                    <UserCheck className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-xs text-gray-500 dark:text-gray-300">{t('communityHelp.noVerifiedHelpers', lang)}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-300 mt-1">{t('communityHelp.checkBackSoon', lang)}</p>
                  </div>
                )}
              </div>

              {/* Become verified */}
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-700 rounded-xl p-3">
                <h4 className="font-semibold text-xs flex items-center gap-1.5 mb-1"><UserCheck className="w-3.5 h-3.5 text-blue-600" /> {t('communityHelp.becomeVerified', lang)}</h4>
                <p className="text-[10px] text-blue-800 dark:text-blue-300 mb-2">{t('communityHelp.becomeVerifiedDesc', lang)}</p>
                <button onClick={() => { setVerifySubmitted(false); setShowVerifyModal(true) }} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-xl text-xs font-semibold transition-colors">{t('communityHelp.applyVerification', lang)}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

      {/* VERIFICATION MODAL*/}
      {showVerifyModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base flex items-center gap-2"><UserCheck className="w-5 h-5 text-blue-600" /> {t('communityHelp.applyVerifiedTitle', lang)}</h3>
              <button onClick={() => setShowVerifyModal(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            {verifySubmitted ? (
              <div className="text-center py-6">
                <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                  <UserCheck className="w-7 h-7 text-green-600" />
                </div>
                <h4 className="font-bold text-sm mb-1">{t('communityHelp.applicationReceived', lang)}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-300 mb-4">{t('communityHelp.applicationReviewMsg', lang)}</p>
                <button onClick={() => setShowVerifyModal(false)} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl text-sm font-semibold">{t('common.close', lang)}</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-700 rounded-xl text-[11px] text-blue-800 dark:text-blue-300">
                  {t('communityHelp.verificationInfo', lang)}
                </div>
                <div>
                  <label className="text-xs font-semibold">{t('communityHelp.fullName', lang)}</label>
                  <input className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" placeholder={t('communityHelp.fullNamePlaceholder', lang)} value={verifyName} onChange={e => setVerifyName(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold">{t('communityHelp.emailAddress', lang)}</label>
                  <input type="email" className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" placeholder={t('communityHelp.emailPlaceholder', lang)} value={verifyEmail} onChange={e => setVerifyEmail(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold">{t('communityHelp.areaCity', lang)}</label>
                  <input className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" placeholder={t('communityHelp.areaCityPlaceholder', lang)} value={verifyArea} onChange={e => setVerifyArea(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold">{t('communityHelp.whatCanYouOffer', lang)}</label>
                  <select className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" value={verifyRole} onChange={e => setVerifyRole(e.target.value)}>
                    <option value="">{t('communityHelp.selectOffer', lang)}</option>
                    <option>{t('communityHelp.offerShelter', lang)}</option>
                      <option>{t('communityHelp.offerFoodMeals', lang)}</option>
                      <option>{t('communityHelp.offerTransportEvacuation', lang)}</option>
                      <option>{t('communityHelp.offerMedicalSupport', lang)}</option>
                      <option>{t('communityHelp.offerClothingSupplies', lang)}</option>
                      <option>{t('communityHelp.offerMultipleTypes', lang)}</option>
                  </select>
                </div>
                <label className="flex items-start gap-2 mt-1 text-[10px] text-gray-500 dark:text-gray-300">
                  <input type="checkbox" className="mt-0.5 w-3.5 h-3.5 rounded" required />
                  {t('communityHelp.confirmAccuracy', lang)}
                </label>
                <button
                  onClick={() => {
                    if (!verifyName || !verifyEmail || !verifyArea || !verifyRole) { pushNotification(t('communityHelp.fillAllFields', lang), 'warning'); return }
                    setVerifySubmitted(true)
                    pushNotification(t('communityHelp.applicationSubmitted', lang), 'success')
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2">
                  <UserCheck className="w-4 h-4" /> {t('communityHelp.submitApplication', lang)}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MORE INFO MODAL*/}
      {infoPost && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-base flex items-center gap-2"><Info className="w-5 h-5 text-blue-500" /> {t('communityHelp.helperDetails', lang)}</h3>
              <button onClick={() => setInfoPost(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] bg-green-100 dark:bg-green-900/30 text-green-700 px-2 py-1 rounded-full font-medium">
                  <TypeIcon type={infoPost.type} className="w-3 h-3" />
                  {COMMUNITY_HELP_TYPES.find(t => t.key === infoPost.type)?.label}
                </span>
                {infoPost.verified && <span className="text-[11px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full font-semibold flex items-center gap-1"><UserCheck className="w-3 h-3" /> {t('communityHelp.verifiedHelper', lang)}</span>}
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{postTranslations[infoPost.description] || infoPost.description}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2.5">
                  <p className="text-gray-500 dark:text-gray-300 text-[10px] mb-0.5">{t('communityHelp.locationLabel', lang)}</p>
                  <p className="font-semibold flex items-center gap-1"><MapPin className="w-3 h-3" /> {infoPost.location}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2.5">
                  <p className="text-gray-500 dark:text-gray-300 text-[10px] mb-0.5">{t('communityHelp.postedLabel', lang)}</p>
                  <p className="font-semibold flex items-center gap-1"><Clock className="w-3 h-3" /> {infoPost.time}</p>
                </div>
              </div>
              {infoPost.safe_meeting && (
                <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-700 rounded-xl">
                  <p className="text-[11px] text-green-700 dark:text-green-300 font-semibold flex items-center gap-1 mb-0.5"><Lock className="w-3 h-3" /> {t('communityHelp.safeMeetingPlaceLabel', lang)}</p>
                  <p className="text-xs text-green-800 dark:text-green-300">{infoPost.safe_meeting}</p>
                </div>
              )}
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-700 rounded-xl text-[10px] text-amber-800 dark:text-amber-300">
                {t('communityHelp.contactRoutedNotice', lang)}
              </div>
              <button onClick={() => { setInfoPost(null); setContactSent(false); setContactMsg(''); setContactPost(infoPost) }}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2">
                <Lock className="w-4 h-4" /> {t('communityHelp.requestSecureContact', lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECURE CONTACT MODAL*/}
      {contactPost && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-base flex items-center gap-2"><Lock className="w-5 h-5 text-green-600" /> {t('communityHelp.requestSecureContact', lang)}</h3>
              <button onClick={() => setContactPost(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            {contactSent ? (
              <div className="text-center py-6">
                <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Lock className="w-7 h-7 text-green-600" />
                </div>
                <h4 className="font-bold text-sm mb-1">{t('communityHelp.secureRequestSent', lang)}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-300 mb-1">{t('communityHelp.requestForwarded', lang)}</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-300 mb-4">{t('communityHelp.ifTheyAccept', lang)}</p>
                <button onClick={() => setContactPost(null)} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-xl text-sm font-semibold">{t('communityHelp.done', lang)}</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-700 rounded-xl">
                  <p className="text-[11px] text-green-800 dark:text-green-300 font-semibold mb-1">{t('communityHelp.aboutLabel', lang)} {(postTranslations[contactPost.description] || contactPost.description).substring(0, 60)}{(postTranslations[contactPost.description] || contactPost.description).length > 60 ? '...' : ''}</p>
                  {contactPost.safe_meeting && <p className="text-[10px] text-green-700 dark:text-green-400 flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> {t('communityHelp.meetLabel', lang)} {contactPost.safe_meeting}</p>}
                </div>
                <div className="p-2.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-xl text-[10px] text-amber-800 dark:text-amber-300">
                  {t('communityHelp.identityAnonymous', lang)}
                </div>
                <div>
                  <label className="text-xs font-semibold">{t('communityHelp.yourMessage', lang)} <span className="font-normal text-gray-400 dark:text-gray-300">{t('communityHelp.optional', lang)}</span></label>
                  <textarea className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 min-h-[80px] resize-none" placeholder={t('communityHelp.messagePlaceholder', lang)} value={contactMsg} onChange={e => setContactMsg(e.target.value)} />
                </div>
                <button
                  onClick={() => { setContactSent(true); pushNotification(t('communityHelp.secureContactSentToast', lang), 'success') }}
                  className="w-full bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> {t('communityHelp.sendAnonymousRequest', lang)}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function PostList({ posts, postTranslations, reported, setReported, pushNotification, TypeIcon, Stars }: any) {
  const lang = getLanguage()
  if (posts.length === 0) return (
    <div className="flex flex-col items-center justify-center py-8 text-center animate-enter">
      <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2">
        <Heart className="w-5 h-5 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('communityHelp.noPostsMatchFilter', lang)}</p>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Try changing the category filter above</p>
    </div>
  )
  return (
    <div className="space-y-2 max-h-[32vh] overflow-y-auto">
      {posts.map((p: any) => (
        <div key={p.id} className={`border rounded-xl p-2.5 ${p.verified ? 'border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20' : 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                  <TypeIcon type={p.type} className="w-2.5 h-2.5" /> {COMMUNITY_HELP_TYPES.find((t: any) => t.key === p.type)?.label}
                </span>
                {p.verified && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-0.5"><UserCheck className="w-2.5 h-2.5" /> {t('communityHelp.verified', lang)}</span>}
                <Stars n={p.rating} />
                <span className="text-[10px] text-gray-500 dark:text-gray-300 ml-auto">{p.time}</span>
              </div>
              <p className="text-xs">{postTranslations[p.description] || p.description}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-0.5 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {p.location}</p>
              {p.safe_meeting && (
                <p className="text-[10px] text-green-700 dark:text-green-400 mt-0.5 flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> {t('communityHelp.meetLabel', lang)} {p.safe_meeting}</p>
              )}
            </div>
            <button onClick={() => { setReported((s: any) => new Set([...s, p.id])); pushNotification(t('communityHelp.reportReceived', lang), 'info') }}
              disabled={reported.has(p.id)} className={`flex-shrink-0 p-1 transition-colors ${reported.has(p.id) ? 'text-gray-300 dark:text-gray-300' : 'text-gray-400 dark:text-gray-300 hover:text-red-500 dark:hover:text-red-400'}`} title={t('communityHelp.reportSuspicious', lang)}>
              <Flag className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function CheckIcon() {
  return (
    <span className="w-3.5 h-3.5 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
      <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  )
}
