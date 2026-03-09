/* CommunityHelp.tsx — Community mutual aid board for citizens to offer/request help. */

import { useState, useEffect, useCallback } from 'react'
import { X, Heart, HelpCircle, MapPin, Clock, Phone, ExternalLink, Navigation, Shield, AlertTriangle, Flag, Home, Droplets, Car, HeartPulse, Shirt, Crosshair, Star, Lock, UserCheck, ChevronRight, Info, CheckCircle, Search, Wifi, Globe, Loader2 } from 'lucide-react'
import { COMMUNITY_HELP_TYPES } from '../../data/disasterTypes'
import { useAlerts } from '../../contexts/AlertsContext'
import { useLocation } from '../../contexts/LocationContext'

interface Props { onClose: () => void }
interface Resource { name: string; type: string; address: string; phone: string; hours: string; dist: string; url: string }
interface Post { id: number; type: string; name: string; description: string; location: string; time: string; verified?: boolean; rating?: number; safe_meeting?: string }

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
    { name: 'Local Emergency Services', type: 'shelter', address: 'Call first responders', phone: '112 (EU) · 911 (US) · 999 (UK) · 000 (AU)', hours: '24/7', dist: 'Nearest', url: '' },
    { name: 'International Red Cross / Red Crescent', type: 'shelter', address: 'Country-wide offices', phone: '+41 22 734 60 01', hours: '24/7', dist: 'Varies', url: 'https://www.icrc.org' },
    { name: 'UNHCR Emergency Shelter', type: 'shelter', address: 'Global operations', phone: '+41 22 739 81 11', hours: '24/7', dist: 'Varies', url: 'https://www.unhcr.org' },
    { name: 'Salvation Army (Worldwide)', type: 'shelter', address: 'National offices worldwide', phone: 'See local listing', hours: '24/7 in emergencies', dist: 'Nearest city', url: 'https://www.salvationarmy.org' },
    { name: 'Community Emergency Centres', type: 'shelter', address: 'Local churches, community halls, schools', phone: 'Ask local authority or police', hours: 'During emergencies', dist: 'Nearest', url: '' },
    { name: 'World Food Programme (WFP)', type: 'food', address: 'Global distribution networks', phone: '+39 06 6513 1', hours: '24/7', dist: 'Varies', url: 'https://www.wfp.org' },
    { name: 'Local Food Bank / Pantry', type: 'food', address: 'Ask council, church or police', phone: 'Local authority', hours: 'Varies by site', dist: 'Nearest', url: 'https://www.foodbanks.org' },
    { name: 'Red Cross Food Aid', type: 'food', address: 'Distribution centres — check local branch', phone: 'Local Red Cross number', hours: 'Emergency hours', dist: 'Regional', url: 'https://www.redcross.org' },
    { name: 'Nearest A&E / Emergency Room', type: 'medical', address: 'Search online or ask police', phone: '112 (EU) · 911 (US) · 999 (UK)', hours: '24/7', dist: 'Nearest', url: '' },
    { name: 'WHO Health Emergencies', type: 'medical', address: 'Global coordination', phone: '+41 22 791 21 11', hours: '24/7', dist: 'Varies', url: 'https://www.who.int/emergencies' },
    { name: 'Crisis / Mental Health Helpline', type: 'medical', address: 'Phone / text service', phone: '116 123 (EU) · 988 (US) · 13 11 14 (AU)', hours: '24/7', dist: 'National', url: 'https://www.samaritans.org' },
    { name: 'Doctors Without Borders (MSF)', type: 'medical', address: 'Deployed to disaster zones', phone: '+32 2 474 74 74', hours: '24/7 in major emergencies', dist: 'Varies', url: 'https://www.msf.org' },
    { name: 'Local Bus / Metro Emergency Routes', type: 'transport', address: 'Ask local authority or police', phone: 'Local transport authority', hours: 'Emergency schedule', dist: 'City-wide', url: '' },
    { name: 'Taxi / Ride-share Services', type: 'transport', address: 'City-wide', phone: 'Uber / local taxi', hours: '24/7 (where available)', dist: 'City-wide', url: 'https://www.uber.com' },
    { name: 'National Ambulance / EMS', type: 'transport', address: 'Emergency only', phone: '112 · 911 · 999 · 000', hours: '24/7', dist: 'Regional', url: '' },
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
  { id: 1, type: 'shelter', name: 'Verified Helper', description: 'Spare room for 2 adults. Warm, dry, WiFi. Verified through council scheme.', location: 'Old Aberdeen', time: '20 mins ago', verified: true, rating: 5, safe_meeting: 'Aberdeen Central Library' },
  { id: 2, type: 'transport', name: 'Verified Helper', description: '4x4 available for evacuation. Can carry 4 passengers + luggage. Enhanced DBS checked.', location: 'Bridge of Don', time: '45 mins ago', verified: true, rating: 4, safe_meeting: 'Tesco Portlethen car park' },
  { id: 3, type: 'food', name: 'Community Kitchen', description: 'Hot meals for 20+ people. Halal, vegetarian and gluten-free options. Free.', location: 'City Centre', time: '1 hour ago', verified: true, rating: 5, safe_meeting: 'City Square (public)' },
  { id: 4, type: 'clothing', name: 'Donation Hub', description: 'Dry clothes, blankets, coats, shoes — all sizes including children.', location: 'Rosemount', time: '1.5 hours ago', verified: false, rating: 4, safe_meeting: 'Salvation Army Aberdeen' },
  { id: 5, type: 'medical', name: 'Volunteer First Aider', description: 'Qualified first aider with kit. Can attend nearby locations during daytime.', location: 'Torry', time: '2 hours ago', verified: true, rating: 5, safe_meeting: 'Aberdeen Community Health Centre' },
]

const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  aberdeen:   { lat: 57.1497, lng: -2.0943 },
  edinburgh:  { lat: 55.9533, lng: -3.1883 },
  glasgow:    { lat: 55.8617, lng: -4.2583 },
  dundee:     { lat: 56.4620, lng: -2.9707 },
  inverness:  { lat: 57.4778, lng: -4.2247 },
  london:     { lat: 51.5074, lng: -0.1278 },
  manchester: { lat: 53.4808, lng: -2.2426 },
  birmingham: { lat: 52.4862, lng: -1.8904 },
  leeds:      { lat: 53.8008, lng: -1.5491 },
  cardiff:    { lat: 51.4816, lng: -3.1791 },
  belfast:    { lat: 54.5973, lng: -5.9301 },
}

function getNearestCity(lat: number, lng: number): string {
  let nearest = 'generic'
  let minDist = Infinity
  for (const [city, center] of Object.entries(CITY_CENTERS)) {
    const d = Math.sqrt((lat - center.lat) ** 2 + (lng - center.lng) ** 2)
    if (d < minDist) { minDist = d; nearest = city }
  }
  return minDist < 1.5 ? nearest : 'generic' // ~110km radius
}

export default function CommunityHelp({ onClose }: Props): JSX.Element {
  const { pushNotification } = useAlerts()
  const { location: loc, activeLocation } = useLocation()

  const [tab, setTab] = useState<'resources' | 'offer' | 'request' | 'network'>('resources')
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS)
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [consent, setConsent] = useState(false)
  const [actionConsent, setActionConsent] = useState(false)
  const [reported, setReported] = useState<Set<number>>(new Set())
  const [locationMode, setLocationMode] = useState<'auto' | 'manual' | null>(null)
  const [userCoords, setUserCoords] = useState<{lat: number; lng: number} | null>(null)
  const [nearbyRadius, setNearbyRadius] = useState(5)
  const [submitting, setSubmitting] = useState(false)
  const [loadingPosts, setLoadingPosts] = useState(false)

  // Helper to fetch with auth token
  const authFetch = useCallback(async (path: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('citizen_token')
    const headers: Record<string, string> = { ...(options.headers as Record<string,string> || {}) }
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json'
    const res = await fetch(path, { ...options, headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    return res.json()
  }, [])

  // Load community help offers/requests from backend on mount
  useEffect(() => {
    let cancelled = false
    const loadPosts = async () => {
      setLoadingPosts(true)
      try {
        const data = await authFetch('/api/extended/community?status=active')
        if (!cancelled && Array.isArray(data)) {
          const apiPosts: Post[] = data.map((item: any) => ({
            id: item.id || Date.now(),
            type: item.category || 'shelter',
            name: item.citizen_id ? 'Community Member' : 'Anonymous',
            description: item.description || item.title,
            location: item.location_text || 'Unknown',
            time: item.created_at ? new Date(item.created_at).toLocaleString() : 'Recently',
            verified: false,
            rating: undefined,
            safe_meeting: undefined,
          }))
          // Merge with initial seed posts for demo, API posts first
          setPosts([...apiPosts, ...INITIAL_POSTS])
        }
      } catch {
        // Silently fall back to initial posts if API is unavailable
      } finally {
        if (!cancelled) setLoadingPosts(false)
      }
    }
    loadPosts()
    return () => { cancelled = true }
  }, [authFetch])

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

  const locationKey = userCoords ? getNearestCity(userCoords.lat, userCoords.lng) : (activeLocation || 'generic')
  const resources = RESOURCES[locationKey] || RESOURCES.generic
  const filtered = (filter === 'all' ? resources : resources.filter(r => r.type === filter))
    .filter(r => !searchTerm || r.name.toLowerCase().includes(searchTerm.toLowerCase()) || r.address.toLowerCase().includes(searchTerm.toLowerCase()))

  const filteredPosts = (filter === 'all' ? posts : posts.filter(p => p.type === filter))
    .filter(p => !searchTerm || p.description.toLowerCase().includes(searchTerm.toLowerCase()))

  const GPS_OPTS: PositionOptions = { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }

  const gps = (set: (v: string) => void) => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        p => {
          set(`${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`)
          setUserCoords({ lat: p.coords.latitude, lng: p.coords.longitude })
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

  const autoDetect = () => {
    if ('geolocation' in navigator) {
      pushNotification('Detecting your location…', 'info')
      navigator.geolocation.getCurrentPosition(
        p => {
          setUserCoords({ lat: p.coords.latitude, lng: p.coords.longitude })
          setLocationMode('auto')
          const city = getNearestCity(p.coords.latitude, p.coords.longitude)
          const cityName = city === 'generic' ? 'your location' : city.charAt(0).toUpperCase() + city.slice(1)
          pushNotification(`Location detected — showing resources near ${cityName}`, 'success')
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

  const doOffer = async () => {
    if (!actionConsent) { pushNotification('Please accept the safety agreement first.', 'warning'); return }
    if (!oType || !oDesc || oDesc.length < 10) { pushNotification('Select a type and add a description (min 10 chars).', 'warning'); return }
    if (!oSafeMeeting) { pushNotification('Please specify a safe public meeting place.', 'warning'); return }

    setSubmitting(true)
    try {
      const result = await authFetch('/api/extended/community', {
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
        id: result?.id || Date.now(), type: oType, name: oVerify ? 'Verified Helper (ID Checked)' : 'Anonymous Helper',
        description: oDesc, location: oLoc || loc.name, time: 'Just now',
        verified: oVerify, rating: undefined, safe_meeting: oSafeMeeting
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
      await authFetch('/api/extended/community', {
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
      {[1,2,3,4,5].map(i => <Star key={i} className={`w-2.5 h-2.5 ${i <= n ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`} />)}
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
            <h2 className="text-lg font-bold">Community Help Network</h2>
            <p className="text-xs text-gray-500 mt-1">Safe, verified mutual aid for your area</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3.5 mb-4">
            <div className="flex items-start gap-2 mb-2">
              <Shield className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <h4 className="font-semibold text-sm">Safety First</h4>
            </div>
            <div className="text-[11px] text-amber-800 dark:text-amber-300 space-y-1">
              {['All interactions are anonymous by default', 'Offers are reviewed before being shown publicly', 'Location sharing is optional — only approximate area', 'Never share personal addresses publicly', 'Always meet helpers in well-lit public places', 'Report suspicious listings — our team reviews them', 'For life emergencies always call 999 / 112 first'].map(t => (
                <p key={t} className="flex items-center gap-1.5"><CheckIcon /> {t}</p>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={onClose} className="order-last text-xs text-gray-400 hover:text-gray-600 text-center py-1">Cancel</button>
            <button onClick={() => setConsent(true)} className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2">
              <Shield className="w-4 h-4" /> I Understand — Continue Safely
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
            <h2 className="text-base font-bold flex items-center gap-2"><Heart className="w-4 h-4" /> Community Help</h2>
            <p className="text-[10px] text-green-100 mt-0.5 flex items-center gap-1">
              <MapPin className="w-2.5 h-2.5" /> {loc.name}
              {userCoords && <span className="bg-green-500/50 px-1.5 py-0.5 rounded-full ml-1 flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> GPS Active</span>}
            </p>
          </div>
          <button onClick={onClose} className="hover:bg-white/20 p-2 rounded-lg transition-colors" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4">
          {/* Tabs */}
          <div className="grid grid-cols-4 gap-1 mb-3">
            {([
              ['resources', 'Resources', Navigation, 'bg-blue-600'],
              ['offer',     'Offer',     Heart,       'bg-green-600'],
              ['request',  'Need Help',  HelpCircle,  'bg-red-600'],
              ['network',  'Network',    Globe,       'bg-amber-600'],
            ] as const).map(([id, label, Icon, color]) => (
              <button key={id} onClick={() => setTab(id as any)}
                className={`py-2 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[9px] sm:text-[10px] font-semibold transition-all ${tab === id ? `${color} text-white shadow-md` : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>
                <Icon className="w-3.5 h-3.5" />
                <span className="leading-tight text-center">{label}</span>
              </button>
            ))}
          </div>

          {/* Search + filter row */}
          <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
            <div className="flex-1 min-w-[130px] flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-xl text-sm">
              <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <input className="flex-1 bg-transparent text-xs outline-none placeholder-gray-400 min-w-0" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <button onClick={() => setFilter('all')} className={`px-2.5 py-1.5 rounded-xl text-[10px] font-medium flex-shrink-0 transition-colors ${filter === 'all' ? 'bg-green-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600'}`}>All</button>
            {COMMUNITY_HELP_TYPES.map(t => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className={`px-2.5 py-1.5 rounded-xl text-[10px] font-medium flex-shrink-0 flex items-center gap-0.5 transition-colors ${filter === t.key ? 'bg-green-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600'}`}>
                <TypeIcon type={t.key} className="w-3 h-3" />
              </button>
            ))}
          </div>

          {/* ── RESOURCES TAB ── */}
          {tab === 'resources' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <p className="text-[10px] text-gray-500">{filtered.length} resources near <strong>{userCoords ? getNearestCity(userCoords.lat, userCoords.lng) : loc.name}</strong></p>
                <button onClick={autoDetect} className="text-[10px] text-blue-500 flex items-center gap-1 hover:underline">
                  <Crosshair className="w-3 h-3" /> Use my GPS
                </button>
              </div>
              <div className="max-h-[58vh] overflow-y-auto space-y-2 pr-1">
                {filtered.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No resources match "{searchTerm || filter}"</p>}
                {filtered.map((r, i) => (
                  <div key={i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 hover:shadow-md transition-all group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded-full font-medium">
                            <TypeIcon type={r.type} className="w-2.5 h-2.5" />
                            {COMMUNITY_HELP_TYPES.find(t => t.key === r.type)?.label}
                          </span>
                          <span className="text-[10px] text-gray-500">{r.dist}</span>
                        </div>
                        <h4 className="font-semibold text-xs group-hover:text-green-600 transition-colors">{r.name}</h4>
                        <p className="text-[10px] text-gray-600 dark:text-gray-400 flex items-center gap-1 mt-0.5"><MapPin className="w-2.5 h-2.5 flex-shrink-0" /> {r.address}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                          <span className="flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" /> {r.phone}</span>
                          <span className="flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" /> {r.hours}</span>
                        </div>
                      </div>
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noopener noreferrer"
                          className="p-2 bg-gray-100 dark:bg-gray-700 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors flex-shrink-0" title="Visit website">
                          <ExternalLink className="w-3.5 h-3.5 text-gray-500 hover:text-green-600" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── OFFER HELP TAB ── */}
          {tab === 'offer' && (
            <div className="space-y-3">
              {!actionConsent ? (
                <div className="p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl">
                  <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-600" /> Offer Agreement</h4>
                  <div className="text-[11px] text-green-800 dark:text-green-300 space-y-1 mb-3">
                    {['Your offer is reviewed before being shown', 'Never include personal address or phone publicly', 'Specify a public safe meeting location', 'Only meet helpers in well-lit public places', 'You can remove your offer at any time', 'False offerings may result in account action'].map(t => (
                      <p key={t} className="flex items-center gap-1.5"><CheckIcon /> {t}</p>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setActionConsent(true)} className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-xl text-xs font-semibold transition-colors">I Agree — Post Offer</button>
                    <button onClick={() => setTab('resources')} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-xl text-xs font-semibold transition-colors">Back</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="p-2.5 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl">
                    <p className="text-[10px] text-green-800 dark:text-green-300 flex items-center gap-1"><Lock className="w-3 h-3" /> <strong>Private:</strong> Contact details never shown publicly. All offers reviewed before going live.</p>
                  </div>

                  {/* Type selector */}
                  <div>
                    <label className="text-xs font-semibold">What can you offer?</label>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 mt-1.5">
                      {COMMUNITY_HELP_TYPES.map(t => (
                        <button key={t.key} onClick={() => setOType(t.key)}
                          className={`p-2 border-2 rounded-xl text-center transition-all ${oType === t.key ? 'border-green-500 bg-green-50 dark:bg-green-950/20 scale-105' : 'border-gray-200 dark:border-gray-700 hover:border-green-300'}`}>
                          <TypeIcon type={t.key} className={`w-5 h-5 mx-auto ${oType === t.key ? 'text-green-600' : 'text-gray-400'}`} />
                          <p className="text-[9px] font-medium mt-0.5 truncate">{t.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-xs font-semibold">Description <span className="text-gray-400 font-normal">(be specific — no personal info)</span></label>
                    <textarea className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 min-h-[80px] resize-none" placeholder="e.g. Spare room for up to 2 adults, warm and dry, local area only..." value={oDesc} onChange={e => setODesc(e.target.value)} />
                    <p className="text-[9px] text-gray-400 mt-0.5">{oDesc.length}/200 chars</p>
                  </div>

                  {/* Approximate area */}
                  <div>
                    <label className="text-xs font-semibold">Approximate area <span className="text-gray-400 font-normal">(not exact address)</span></label>
                    <div className="flex gap-1.5 mt-1">
                      <input className="flex-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" placeholder="e.g. Old Aberdeen, North side of city..." value={oLoc} onChange={e => setOLoc(e.target.value)} />
                      <button onClick={() => gps(setOLoc)} className="px-3 py-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-700 rounded-xl text-[10px] font-medium flex items-center gap-1 transition-colors hover:bg-blue-100">
                        <Crosshair className="w-3.5 h-3.5 text-blue-500" /> GPS
                      </button>
                    </div>
                  </div>

                  {/* Safe meeting place */}
                  <div>
                    <label className="text-xs font-semibold flex items-center gap-1.5"><Lock className="w-3 h-3 text-green-600" /> Safe public meeting place</label>
                    <select className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" value={oSafeMeeting} onChange={e => setOSafeMeeting(e.target.value)}>
                      <option value="">Select a public meeting place...</option>
                      {SAFE_MEETING_PLACES.map(p => <option key={p} value={p}>{p}</option>)}
                      <option value="other">Other (type below)</option>
                    </select>
                    {oSafeMeeting === 'other' && (
                      <input className="w-full mt-1.5 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" placeholder="Specify public location..." onChange={e => setOSafeMeeting(e.target.value === 'other' ? '' : e.target.value)} />
                    )}
                  </div>

                  {/* Identity verification option */}
                  <label className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-700 rounded-xl cursor-pointer">
                    <input type="checkbox" checked={oVerify} onChange={e => setOVerify(e.target.checked)} className="w-4 h-4 rounded border-blue-300 text-blue-600" />
                    <div>
                      <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1"><UserCheck className="w-3.5 h-3.5" /> Request Verified Badge</p>
                      <p className="text-[10px] text-blue-700 dark:text-blue-400 mt-0.5">I confirm I am who I say I am. My listing will show a verified badge and may require ID check.</p>
                    </div>
                  </label>

                  <button onClick={doOffer} disabled={submitting} className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors shadow-md">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Heart className="w-4 h-4" />} {submitting ? 'Posting...' : 'Post Offer (Anonymous · Moderated)'}
                  </button>
                </>
              )}

              {/* Existing posts */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-2">
                <h4 className="font-semibold text-xs mb-2 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-green-500" /> Community Offers ({filteredPosts.length})</h4>
                <PostList posts={filteredPosts} reported={reported} setReported={setReported} pushNotification={pushNotification} TypeIcon={TypeIcon} Stars={Stars} />
              </div>
            </div>
          )}

          {/* ── REQUEST HELP TAB ── */}
          {tab === 'request' && (
            <div className="space-y-3">
              {!actionConsent ? (
                <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl">
                  <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5"><Shield className="w-4 h-4 text-red-600" /> Request Agreement</h4>
                  <div className="text-[11px] text-red-900 dark:text-red-300 space-y-1 mb-3">
                    {['Your request is completely anonymous', 'Only share approximate area — not exact address', 'Only meet helpers in well-lit public places', 'Call 999 for life-threatening emergencies', 'Do not disclose financial details to helpers', 'False requests may block future access'].map(t => (
                      <p key={t} className="flex items-center gap-1.5"><CheckIcon /> {t}</p>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setActionConsent(true)} className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl text-xs font-semibold transition-colors">I Agree — Request Help</button>
                    <button onClick={() => setTab('resources')} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-xl text-xs font-semibold transition-colors">Back</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="p-2.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-[10px] text-red-800 dark:text-red-300"><strong>Emergency?</strong> Call <strong>999</strong> (UK) or <strong>112</strong> (EU) first. This is for non-emergency community assistance.</p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold">What do you need?</label>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 mt-1.5">
                      {COMMUNITY_HELP_TYPES.map(t => (
                        <button key={t.key} onClick={() => setRType(t.key)}
                          className={`p-2 border-2 rounded-xl text-center transition-all ${rType === t.key ? 'border-red-500 bg-red-50 dark:bg-red-950/20 scale-105' : 'border-gray-200 dark:border-gray-700 hover:border-red-300'}`}>
                          <TypeIcon type={t.key} className={`w-5 h-5 mx-auto ${rType === t.key ? 'text-red-600' : 'text-gray-400'}`} />
                          <p className="text-[9px] font-medium mt-0.5 truncate">{t.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold">Details <span className="text-gray-400 font-normal">(no personal info)</span></label>
                    <textarea className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 min-h-[70px] resize-none" placeholder={`Number of people, specific needs, accessibility requirements...`} value={rDesc} onChange={e => setRDesc(e.target.value)} />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-semibold">No. of people</label>
                      <select className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" value={rPeople} onChange={e => setRPeople(e.target.value)}>
                        {['1','2','3','4','5','6+'].map(n => <option key={n} value={n}>{n} {n === '1' ? 'person' : 'people'}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold">Approximate area</label>
                      <div className="flex gap-1 mt-1">
                        <input className="flex-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" placeholder="Area or postcode" value={rLoc} onChange={e => setRLoc(e.target.value)} />
                        <button onClick={() => gps(setRLoc)} className="px-2 py-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-700 rounded-xl hover:bg-blue-100 transition-colors">
                          <Crosshair className="w-3 h-3 text-blue-500" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <label className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-700 rounded-xl cursor-pointer">
                    <input type="checkbox" checked={rUrgent} onChange={e => setRUrgent(e.target.checked)} className="w-4 h-4 rounded border-red-300 text-red-600" />
                    <div>
                      <p className="text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Mark as Urgent</p>
                      <p className="text-[10px] text-red-600 dark:text-red-400">Immediately alerts nearest available verified volunteers</p>
                    </div>
                  </label>

                  <button onClick={doRequest} disabled={submitting} className={`w-full ${rUrgent ? 'bg-red-700 hover:bg-red-800' : 'bg-red-600 hover:bg-red-700'} disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors shadow-md`}>
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : rUrgent ? <AlertTriangle className="w-4 h-4" /> : <HelpCircle className="w-4 h-4" />} {submitting ? 'Submitting...' : rUrgent ? 'Send Urgent Request' : 'Submit Request (Anonymous)'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── NETWORK TAB ── */}
          {tab === 'network' && (
            <div className="space-y-3">
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3.5">
                <h4 className="font-bold text-sm flex items-center gap-2 mb-2"><UserCheck className="w-4 h-4 text-amber-600" /> Verified Community Network</h4>
                <p className="text-[11px] text-amber-800 dark:text-amber-300">These helpers have been verified through official channels. Higher trust, always use public meeting places.</p>
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
                          {p.verified && <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-0.5"><UserCheck className="w-2.5 h-2.5" /> Verified</span>}
                          <Stars n={p.rating} />
                        </div>
                        <p className="text-xs">{p.description}</p>
                        <p className="text-[10px] text-gray-500 mt-1 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {p.location}</p>
                        {p.safe_meeting && (
                          <p className="text-[10px] text-green-700 dark:text-green-400 mt-0.5 flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> Meet at: {p.safe_meeting}</p>
                        )}
                      </div>
                      <button onClick={() => { setReported(s => new Set([...s, p.id])); pushNotification('Report received. Our team will review this listing.', 'info') }} disabled={reported.has(p.id)} className="text-gray-300 hover:text-red-500 p-1 transition-colors flex-shrink-0" title="Report listing">
                        <Flag className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setContactSent(false); setContactMsg(''); setContactPost(p) }} className="flex-1 bg-green-50 dark:bg-green-950/20 hover:bg-green-100 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-300 py-1.5 rounded-lg text-[10px] font-semibold transition-colors flex items-center justify-center gap-1">
                        <Lock className="w-3 h-3" /> Request Secure Contact
                      </button>
                      <button onClick={() => setInfoPost(p)} className="flex-1 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 border border-gray-200 dark:border-gray-600 py-1.5 rounded-lg text-[10px] font-semibold transition-colors flex items-center justify-center gap-1">
                        <Info className="w-3 h-3" /> More Info
                      </button>
                    </div>
                  </div>
                ))}
                {filteredPosts.filter(p => p.verified).length === 0 && (
                  <div className="text-center py-8">
                    <UserCheck className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-xs text-gray-500">No verified helpers in this category yet</p>
                    <p className="text-[10px] text-gray-400 mt-1">Check back soon or view all community offers</p>
                  </div>
                )}
              </div>

              {/* Become verified */}
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-700 rounded-xl p-3">
                <h4 className="font-semibold text-xs flex items-center gap-1.5 mb-1"><UserCheck className="w-3.5 h-3.5 text-blue-600" /> Become a Verified Helper</h4>
                <p className="text-[10px] text-blue-800 dark:text-blue-300 mb-2">Verified helpers receive more requests. Requires identity confirmation through our local authority partner scheme.</p>
                <button onClick={() => { setVerifySubmitted(false); setShowVerifyModal(true) }} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-xl text-xs font-semibold transition-colors">Apply for Verification</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

      {/* ── VERIFICATION MODAL ── */}
      {showVerifyModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base flex items-center gap-2"><UserCheck className="w-5 h-5 text-blue-600" /> Apply for Verified Helper Status</h3>
              <button onClick={() => setShowVerifyModal(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            {verifySubmitted ? (
              <div className="text-center py-6">
                <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                  <UserCheck className="w-7 h-7 text-green-600" />
                </div>
                <h4 className="font-bold text-sm mb-1">Application Received!</h4>
                <p className="text-xs text-gray-500 mb-4">We'll review your details within 2–3 working days and contact you at the email provided.</p>
                <button onClick={() => setShowVerifyModal(false)} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl text-sm font-semibold">Close</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-700 rounded-xl text-[11px] text-blue-800 dark:text-blue-300">
                  Verification is free and processed through our local authority partner scheme. You will receive a badge visible to people requesting help.
                </div>
                <div>
                  <label className="text-xs font-semibold">Full Name</label>
                  <input className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" placeholder="Your legal full name" value={verifyName} onChange={e => setVerifyName(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold">Email Address</label>
                  <input type="email" className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" placeholder="your@email.com" value={verifyEmail} onChange={e => setVerifyEmail(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold">Area / City</label>
                  <input className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" placeholder="e.g. Aberdeen, Edinburgh, Glasgow…" value={verifyArea} onChange={e => setVerifyArea(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold">What can you offer?</label>
                  <select className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" value={verifyRole} onChange={e => setVerifyRole(e.target.value)}>
                    <option value="">Select…</option>
                    <option>Emergency shelter / spare room</option>
                    <option>Food / meals provision</option>
                    <option>Transport / evacuation</option>
                    <option>Medical / first aid support</option>
                    <option>Clothing / supplies</option>
                    <option>Multiple types</option>
                  </select>
                </div>
                <label className="flex items-start gap-2 mt-1 text-[10px] text-gray-500">
                  <input type="checkbox" className="mt-0.5 w-3.5 h-3.5 rounded" required />
                  I confirm all information is accurate and I consent to identity verification by our moderation team.
                </label>
                <button
                  onClick={() => {
                    if (!verifyName || !verifyEmail || !verifyArea || !verifyRole) { pushNotification('Please fill in all fields', 'warning'); return }
                    setVerifySubmitted(true)
                    pushNotification('Application submitted — we\'ll review within 2–3 working days', 'success')
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2">
                  <UserCheck className="w-4 h-4" /> Submit Application
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MORE INFO MODAL ── */}
      {infoPost && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-base flex items-center gap-2"><Info className="w-5 h-5 text-blue-500" /> Helper Details</h3>
              <button onClick={() => setInfoPost(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] bg-green-100 dark:bg-green-900/30 text-green-700 px-2 py-1 rounded-full font-medium">
                  <TypeIcon type={infoPost.type} className="w-3 h-3" />
                  {COMMUNITY_HELP_TYPES.find(t => t.key === infoPost.type)?.label}
                </span>
                {infoPost.verified && <span className="text-[11px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full font-semibold flex items-center gap-1"><UserCheck className="w-3 h-3" /> Verified Helper</span>}
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{infoPost.description}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2.5">
                  <p className="text-gray-500 text-[10px] mb-0.5">Location</p>
                  <p className="font-semibold flex items-center gap-1"><MapPin className="w-3 h-3" /> {infoPost.location}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2.5">
                  <p className="text-gray-500 text-[10px] mb-0.5">Posted</p>
                  <p className="font-semibold flex items-center gap-1"><Clock className="w-3 h-3" /> {infoPost.time}</p>
                </div>
              </div>
              {infoPost.safe_meeting && (
                <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-700 rounded-xl">
                  <p className="text-[11px] text-green-700 dark:text-green-300 font-semibold flex items-center gap-1 mb-0.5"><Lock className="w-3 h-3" /> Safe Public Meeting Place</p>
                  <p className="text-xs text-green-800 dark:text-green-300">{infoPost.safe_meeting}</p>
                </div>
              )}
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-700 rounded-xl text-[10px] text-amber-800 dark:text-amber-300">
                Contact is routed through our anonymous secure system. The helper never sees your personal details until you choose to share them at the agreed public meeting point.
              </div>
              <button onClick={() => { setInfoPost(null); setContactSent(false); setContactMsg(''); setContactPost(infoPost) }}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2">
                <Lock className="w-4 h-4" /> Request Secure Contact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SECURE CONTACT MODAL ── */}
      {contactPost && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-base flex items-center gap-2"><Lock className="w-5 h-5 text-green-600" /> Request Secure Contact</h3>
              <button onClick={() => setContactPost(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            {contactSent ? (
              <div className="text-center py-6">
                <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Lock className="w-7 h-7 text-green-600" />
                </div>
                <h4 className="font-bold text-sm mb-1">Secure Request Sent</h4>
                <p className="text-xs text-gray-500 mb-1">Your anonymous request has been forwarded to the helper.</p>
                <p className="text-[10px] text-gray-400 mb-4">If they accept, you'll receive a notification to arrange a meeting at the agreed public location.</p>
                <button onClick={() => setContactPost(null)} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-xl text-sm font-semibold">Done</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-700 rounded-xl">
                  <p className="text-[11px] text-green-800 dark:text-green-300 font-semibold mb-1">About: {contactPost.description.substring(0, 60)}{contactPost.description.length > 60 ? '...' : ''}</p>
                  {contactPost.safe_meeting && <p className="text-[10px] text-green-700 dark:text-green-400 flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> Meeting: {contactPost.safe_meeting}</p>}
                </div>
                <div className="p-2.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-xl text-[10px] text-amber-800 dark:text-amber-300">
                  Your identity is fully anonymous. The helper will only know your approximate area and what you need.
                </div>
                <div>
                  <label className="text-xs font-semibold">Your message <span className="font-normal text-gray-400">(optional)</span></label>
                  <textarea className="w-full mt-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 min-h-[80px] resize-none" placeholder="e.g. I need shelter for 2 adults and a child, dog-friendly if possible. I can travel to the meeting point." value={contactMsg} onChange={e => setContactMsg(e.target.value)} />
                </div>
                <button
                  onClick={() => { setContactSent(true); pushNotification('Secure contact request sent — the helper will respond if available', 'success') }}
                  className="w-full bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> Send Anonymous Request
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function PostList({ posts, reported, setReported, pushNotification, TypeIcon, Stars }: any) {
  if (posts.length === 0) return <p className="text-xs text-gray-400 text-center py-4">No posts match your filter</p>
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
                {p.verified && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-0.5"><UserCheck className="w-2.5 h-2.5" /> Verified</span>}
                <Stars n={p.rating} />
                <span className="text-[10px] text-gray-500 ml-auto">{p.time}</span>
              </div>
              <p className="text-xs">{p.description}</p>
              <p className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {p.location}</p>
              {p.safe_meeting && (
                <p className="text-[10px] text-green-700 dark:text-green-400 mt-0.5 flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> Meet: {p.safe_meeting}</p>
              )}
            </div>
            <button onClick={() => { setReported((s: any) => new Set([...s, p.id])); pushNotification('Report received. Our team will review.', 'info') }}
              disabled={reported.has(p.id)} className={`flex-shrink-0 p-1 transition-colors ${reported.has(p.id) ? 'text-gray-300' : 'text-gray-400 hover:text-red-500'}`} title="Report suspicious">
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









