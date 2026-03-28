/**
 * Comprehensive country codes for international phone numbers
 * All 195 UN-recognized countries + territories
 * E.164 format support
 */

import { codeToFlag } from './countryCodes'

export interface CountryCode {
  code: string
  name: string
  dial: string
  flag: string
  format: string
}

export const ALL_COUNTRY_CODES: CountryCode[] = [
  // A
  { code: 'AF', name: 'Afghanistan', dial: '+93', flag: codeToFlag('AF'), format: '70 123 4567' },
  { code: 'AL', name: 'Albania', dial: '+355', flag: codeToFlag('AL'), format: '66 123 4567' },
  { code: 'DZ', name: 'Algeria', dial: '+213', flag: codeToFlag('DZ'), format: '551 23 45 67' },
  { code: 'AS', name: 'American Samoa', dial: '+1684', flag: codeToFlag('AS'), format: '733 1234' },
  { code: 'AD', name: 'Andorra', dial: '+376', flag: codeToFlag('AD'), format: '312 345' },
  { code: 'AO', name: 'Angola', dial: '+244', flag: codeToFlag('AO'), format: '923 123 456' },
  { code: 'AI', name: 'Anguilla', dial: '+1264', flag: codeToFlag('AI'), format: '235 1234' },
  { code: 'AG', name: 'Antigua and Barbuda', dial: '+1268', flag: codeToFlag('AG'), format: '464 1234' },
  { code: 'AR', name: 'Argentina', dial: '+54', flag: codeToFlag('AR'), format: '11 2345-6789' },
  { code: 'AM', name: 'Armenia', dial: '+374', flag: codeToFlag('AM'), format: '77 123456' },
  { code: 'AW', name: 'Aruba', dial: '+297', flag: codeToFlag('AW'), format: '560 1234' },
  { code: 'AU', name: 'Australia', dial: '+61', flag: codeToFlag('AU'), format: '412 345 678' },
  { code: 'AT', name: 'Austria', dial: '+43', flag: codeToFlag('AT'), format: '664 123456' },
  { code: 'AZ', name: 'Azerbaijan', dial: '+994', flag: codeToFlag('AZ'), format: '40 123 45 67' },
  
  // B
  { code: 'BS', name: 'Bahamas', dial: '+1242', flag: codeToFlag('BS'), format: '359 1234' },
  { code: 'BH', name: 'Bahrain', dial: '+973', flag: codeToFlag('BH'), format: '3600 1234' },
  { code: 'BD', name: 'Bangladesh', dial: '+880', flag: codeToFlag('BD'), format: '1812 345678' },
  { code: 'BB', name: 'Barbados', dial: '+1246', flag: codeToFlag('BB'), format: '250 1234' },
  { code: 'BY', name: 'Belarus', dial: '+375', flag: codeToFlag('BY'), format: '29 123 45 67' },
  { code: 'BE', name: 'Belgium', dial: '+32', flag: codeToFlag('BE'), format: '470 12 34 56' },
  { code: 'BZ', name: 'Belize', dial: '+501', flag: codeToFlag('BZ'), format: '622 1234' },
  { code: 'BJ', name: 'Benin', dial: '+229', flag: codeToFlag('BJ'), format: '90 01 12 34' },
  { code: 'BM', name: 'Bermuda', dial: '+1441', flag: codeToFlag('BM'), format: '370 1234' },
  { code: 'BT', name: 'Bhutan', dial: '+975', flag: codeToFlag('BT'), format: '17 12 34 56' },
  { code: 'BO', name: 'Bolivia', dial: '+591', flag: codeToFlag('BO'), format: '7123 4567' },
  { code: 'BA', name: 'Bosnia and Herzegovina', dial: '+387', flag: codeToFlag('BA'), format: '61 123 456' },
  { code: 'BW', name: 'Botswana', dial: '+267', flag: codeToFlag('BW'), format: '71 123 456' },
  { code: 'BR', name: 'Brazil', dial: '+55', flag: codeToFlag('BR'), format: '11 91234-5678' },
  { code: 'BN', name: 'Brunei', dial: '+673', flag: codeToFlag('BN'), format: '712 3456' },
  { code: 'BG', name: 'Bulgaria', dial: '+359', flag: codeToFlag('BG'), format: '87 123 4567' },
  { code: 'BF', name: 'Burkina Faso', dial: '+226', flag: codeToFlag('BF'), format: '70 12 34 56' },
  { code: 'BI', name: 'Burundi', dial: '+257', flag: codeToFlag('BI'), format: '79 56 12 34' },
  
  // C
  { code: 'KH', name: 'Cambodia', dial: '+855', flag: codeToFlag('KH'), format: '91 234 567' },
  { code: 'CM', name: 'Cameroon', dial: '+237', flag: codeToFlag('CM'), format: '6 71 23 45 67' },
  { code: 'CA', name: 'Canada', dial: '+1', flag: codeToFlag('CA'), format: '(416) 555-1234' },
  { code: 'CV', name: 'Cape Verde', dial: '+238', flag: codeToFlag('CV'), format: '991 12 34' },
  { code: 'KY', name: 'Cayman Islands', dial: '+1345', flag: codeToFlag('KY'), format: '323 1234' },
  { code: 'CF', name: 'Central African Republic', dial: '+236', flag: codeToFlag('CF'), format: '70 01 23 45' },
  { code: 'TD', name: 'Chad', dial: '+235', flag: codeToFlag('TD'), format: '63 01 23 45' },
  { code: 'CL', name: 'Chile', dial: '+56', flag: codeToFlag('CL'), format: '9 1234 5678' },
  { code: 'CN', name: 'China', dial: '+86', flag: codeToFlag('CN'), format: '131 2345 6789' },
  { code: 'CO', name: 'Colombia', dial: '+57', flag: codeToFlag('CO'), format: '312 3456789' },
  { code: 'KM', name: 'Comoros', dial: '+269', flag: codeToFlag('KM'), format: '321 23 45' },
  { code: 'CG', name: 'Congo', dial: '+242', flag: codeToFlag('CG'), format: '06 123 4567' },
  { code: 'CD', name: 'Congo (DRC)', dial: '+243', flag: codeToFlag('CD'), format: '991 234 567' },
  { code: 'CK', name: 'Cook Islands', dial: '+682', flag: codeToFlag('CK'), format: '71 234' },
  { code: 'CR', name: 'Costa Rica', dial: '+506', flag: codeToFlag('CR'), format: '8312 3456' },
  { code: 'HR', name: 'Croatia', dial: '+385', flag: codeToFlag('HR'), format: '91 234 5678' },
  { code: 'CU', name: 'Cuba', dial: '+53', flag: codeToFlag('CU'), format: '5 1234567' },
  { code: 'CW', name: 'Cura—ao', dial: '+599', flag: codeToFlag('CW'), format: '9 518 1234' },
  { code: 'CY', name: 'Cyprus', dial: '+357', flag: codeToFlag('CY'), format: '96 123456' },
  { code: 'CZ', name: 'Czech Republic', dial: '+420', flag: codeToFlag('CZ'), format: '601 123 456' },
  
  // D
  { code: 'DK', name: 'Denmark', dial: '+45', flag: codeToFlag('DK'), format: '32 12 34 56' },
  { code: 'DJ', name: 'Djibouti', dial: '+253', flag: codeToFlag('DJ'), format: '77 83 10 01' },
  { code: 'DM', name: 'Dominica', dial: '+1767', flag: codeToFlag('DM'), format: '225 1234' },
  { code: 'DO', name: 'Dominican Republic', dial: '+1809', flag: codeToFlag('DO'), format: '809-234-5678' },
  
  // E
  { code: 'EC', name: 'Ecuador', dial: '+593', flag: codeToFlag('EC'), format: '99 123 4567' },
  { code: 'EG', name: 'Egypt', dial: '+20', flag: codeToFlag('EG'), format: '100 123 4567' },
  { code: 'SV', name: 'El Salvador', dial: '+503', flag: codeToFlag('SV'), format: '7012 3456' },
  { code: 'GQ', name: 'Equatorial Guinea', dial: '+240', flag: codeToFlag('GQ'), format: '222 123 456' },
  { code: 'ER', name: 'Eritrea', dial: '+291', flag: codeToFlag('ER'), format: '7 123 456' },
  { code: 'EE', name: 'Estonia', dial: '+372', flag: codeToFlag('EE'), format: '5123 4567' },
  { code: 'ET', name: 'Ethiopia', dial: '+251', flag: codeToFlag('ET'), format: '91 123 4567' },
  
  // F
  { code: 'FJ', name: 'Fiji', dial: '+679', flag: codeToFlag('FJ'), format: '701 2345' },
  { code: 'FI', name: 'Finland', dial: '+358', flag: codeToFlag('FI'), format: '40 123 4567' },
  { code: 'FR', name: 'France', dial: '+33', flag: codeToFlag('FR'), format: '6 12 34 56 78' },
  { code: 'GF', name: 'French Guiana', dial: '+594', flag: codeToFlag('GF'), format: '694 20 12 34' },
  { code: 'PF', name: 'French Polynesia', dial: '+689', flag: codeToFlag('PF'), format: '87 12 34 56' },
  
  // G
  { code: 'GA', name: 'Gabon', dial: '+241', flag: codeToFlag('GA'), format: '06 03 12 34' },
  { code: 'GM', name: 'Gambia', dial: '+220', flag: codeToFlag('GM'), format: '301 2345' },
  { code: 'GE', name: 'Georgia', dial: '+995', flag: codeToFlag('GE'), format: '555 12 34 56' },
  { code: 'DE', name: 'Germany', dial: '+49', flag: codeToFlag('DE'), format: '151 23456789' },
  { code: 'GH', name: 'Ghana', dial: '+233', flag: codeToFlag('GH'), format: '23 123 4567' },
  { code: 'GI', name: 'Gibraltar', dial: '+350', flag: codeToFlag('GI'), format: '57123456' },
  { code: 'GR', name: 'Greece', dial: '+30', flag: codeToFlag('GR'), format: '691 234 5678' },
  { code: 'GL', name: 'Greenland', dial: '+299', flag: codeToFlag('GL'), format: '22 12 34' },
  { code: 'GD', name: 'Grenada', dial: '+1473', flag: codeToFlag('GD'), format: '403 1234' },
  { code: 'GP', name: 'Guadeloupe', dial: '+590', flag: codeToFlag('GP'), format: '690 30 12 34' },
  { code: 'GU', name: 'Guam', dial: '+1671', flag: codeToFlag('GU'), format: '300 1234' },
  { code: 'GT', name: 'Guatemala', dial: '+502', flag: codeToFlag('GT'), format: '5123 4567' },
  { code: 'GN', name: 'Guinea', dial: '+224', flag: codeToFlag('GN'), format: '601 12 34 56' },
  { code: 'GW', name: 'Guinea-Bissau', dial: '+245', flag: codeToFlag('GW'), format: '955 012 345' },
  { code: 'GY', name: 'Guyana', dial: '+592', flag: codeToFlag('GY'), format: '609 1234' },
  
  // H
  { code: 'HT', name: 'Haiti', dial: '+509', flag: codeToFlag('HT'), format: '34 10 1234' },
  { code: 'HN', name: 'Honduras', dial: '+504', flag: codeToFlag('HN'), format: '9123 4567' },
  { code: 'HK', name: 'Hong Kong', dial: '+852', flag: codeToFlag('HK'), format: '5123 4567' },
  { code: 'HU', name: 'Hungary', dial: '+36', flag: codeToFlag('HU'), format: '20 123 4567' },
  
  // I
  { code: 'IS', name: 'Iceland', dial: '+354', flag: codeToFlag('IS'), format: '611 1234' },
  { code: 'IN', name: 'India', dial: '+91', flag: codeToFlag('IN'), format: '81234 56789' },
  { code: 'ID', name: 'Indonesia', dial: '+62', flag: codeToFlag('ID'), format: '812 3456 7890' },
  { code: 'IR', name: 'Iran', dial: '+98', flag: codeToFlag('IR'), format: '912 345 6789' },
  { code: 'IQ', name: 'Iraq', dial: '+964', flag: codeToFlag('IQ'), format: '791 234 5678' },
  { code: 'IE', name: 'Ireland', dial: '+353', flag: codeToFlag('IE'), format: '85 123 4567' },
  { code: 'IL', name: 'Israel', dial: '+972', flag: codeToFlag('IL'), format: '50 123 4567' },
  { code: 'IT', name: 'Italy', dial: '+39', flag: codeToFlag('IT'), format: '312 345 6789' },
  { code: 'CI', name: 'Ivory Coast', dial: '+225', flag: codeToFlag('CI'), format: '01 23 45 67' },
  
  // J
  { code: 'JM', name: 'Jamaica', dial: '+1876', flag: codeToFlag('JM'), format: '210 1234' },
  { code: 'JP', name: 'Japan', dial: '+81', flag: codeToFlag('JP'), format: '90 1234 5678' },
  { code: 'JO', name: 'Jordan', dial: '+962', flag: codeToFlag('JO'), format: '7 9012 3456' },
  
  // K
  { code: 'KZ', name: 'Kazakhstan', dial: '+7', flag: codeToFlag('KZ'), format: '771 000 9998' },
  { code: 'KE', name: 'Kenya', dial: '+254', flag: codeToFlag('KE'), format: '712 345678' },
  { code: 'KI', name: 'Kiribati', dial: '+686', flag: codeToFlag('KI'), format: '72012345' },
  { code: 'XK', name: 'Kosovo', dial: '+383', flag: codeToFlag('XK'), format: '43 201 234' },
  { code: 'KW', name: 'Kuwait', dial: '+965', flag: codeToFlag('KW'), format: '500 12345' },
  { code: 'KG', name: 'Kyrgyzstan', dial: '+996', flag: codeToFlag('KG'), format: '700 123 456' },
  
  // L
  { code: 'LA', name: 'Laos', dial: '+856', flag: codeToFlag('LA'), format: '20 23 123 456' },
  { code: 'LV', name: 'Latvia', dial: '+371', flag: codeToFlag('LV'), format: '21 234 567' },
  { code: 'LB', name: 'Lebanon', dial: '+961', flag: codeToFlag('LB'), format: '71 123 456' },
  { code: 'LS', name: 'Lesotho', dial: '+266', flag: codeToFlag('LS'), format: '5012 3456' },
  { code: 'LR', name: 'Liberia', dial: '+231', flag: codeToFlag('LR'), format: '77 012 3456' },
  { code: 'LY', name: 'Libya', dial: '+218', flag: codeToFlag('LY'), format: '91 2345678' },
  { code: 'LI', name: 'Liechtenstein', dial: '+423', flag: codeToFlag('LI'), format: '660 234 567' },
  { code: 'LT', name: 'Lithuania', dial: '+370', flag: codeToFlag('LT'), format: '612 34567' },
  { code: 'LU', name: 'Luxembourg', dial: '+352', flag: codeToFlag('LU'), format: '628 123 456' },
  
  // M
  { code: 'MO', name: 'Macau', dial: '+853', flag: codeToFlag('MO'), format: '6612 3456' },
  { code: 'MK', name: 'Macedonia', dial: '+389', flag: codeToFlag('MK'), format: '72 345 678' },
  { code: 'MG', name: 'Madagascar', dial: '+261', flag: codeToFlag('MG'), format: '32 12 345 67' },
  { code: 'MW', name: 'Malawi', dial: '+265', flag: codeToFlag('MW'), format: '991 23 45 67' },
  { code: 'MY', name: 'Malaysia', dial: '+60', flag: codeToFlag('MY'), format: '12 345 6789' },
  { code: 'MV', name: 'Maldives', dial: '+960', flag: codeToFlag('MV'), format: '771 2345' },
  { code: 'ML', name: 'Mali', dial: '+223', flag: codeToFlag('ML'), format: '65 01 23 45' },
  { code: 'MT', name: 'Malta', dial: '+356', flag: codeToFlag('MT'), format: '9696 1234' },
  { code: 'MH', name: 'Marshall Islands', dial: '+692', flag: codeToFlag('MH'), format: '235 1234' },
  { code: 'MQ', name: 'Martinique', dial: '+596', flag: codeToFlag('MQ'), format: '696 20 12 34' },
  { code: 'MR', name: 'Mauritania', dial: '+222', flag: codeToFlag('MR'), format: '22 12 34 56' },
  { code: 'MU', name: 'Mauritius', dial: '+230', flag: codeToFlag('MU'), format: '5251 2345' },
  { code: 'YT', name: 'Mayotte', dial: '+262', flag: codeToFlag('YT'), format: '639 01 23 45' },
  { code: 'MX', name: 'Mexico', dial: '+52', flag: codeToFlag('MX'), format: '55 1234 5678' },
  { code: 'FM', name: 'Micronesia', dial: '+691', flag: codeToFlag('FM'), format: '350 1234' },
  { code: 'MD', name: 'Moldova', dial: '+373', flag: codeToFlag('MD'), format: '621 12 345' },
  { code: 'MC', name: 'Monaco', dial: '+377', flag: codeToFlag('MC'), format: '6 12 34 56 78' },
  { code: 'MN', name: 'Mongolia', dial: '+976', flag: codeToFlag('MN'), format: '8812 3456' },
  { code: 'ME', name: 'Montenegro', dial: '+382', flag: codeToFlag('ME'), format: '67 622 901' },
  { code: 'MS', name: 'Montserrat', dial: '+1664', flag: codeToFlag('MS'), format: '492 1234' },
  { code: 'MA', name: 'Morocco', dial: '+212', flag: codeToFlag('MA'), format: '650 123456' },
  { code: 'MZ', name: 'Mozambique', dial: '+258', flag: codeToFlag('MZ'), format: '82 123 4567' },
  { code: 'MM', name: 'Myanmar', dial: '+95', flag: codeToFlag('MM'), format: '9 212 3456' },
  
  // N
  { code: 'NA', name: 'Namibia', dial: '+264', flag: codeToFlag('NA'), format: '81 123 4567' },
  { code: 'NR', name: 'Nauru', dial: '+674', flag: codeToFlag('NR'), format: '555 1234' },
  { code: 'NP', name: 'Nepal', dial: '+977', flag: codeToFlag('NP'), format: '984 1234567' },
  { code: 'NL', name: 'Netherlands', dial: '+31', flag: codeToFlag('NL'), format: '6 12345678' },
  { code: 'NC', name: 'New Caledonia', dial: '+687', flag: codeToFlag('NC'), format: '75 12 34' },
  { code: 'NZ', name: 'New Zealand', dial: '+64', flag: codeToFlag('NZ'), format: '21 123 4567' },
  { code: 'NI', name: 'Nicaragua', dial: '+505', flag: codeToFlag('NI'), format: '8123 4567' },
  { code: 'NE', name: 'Niger', dial: '+227', flag: codeToFlag('NE'), format: '93 12 34 56' },
  { code: 'NG', name: 'Nigeria', dial: '+234', flag: codeToFlag('NG'), format: '802 123 4567' },
  { code: 'NU', name: 'Niue', dial: '+683', flag: codeToFlag('NU'), format: '1234' },
  { code: 'KP', name: 'North Korea', dial: '+850', flag: codeToFlag('KP'), format: '192 123 4567' },
  { code: 'NO', name: 'Norway', dial: '+47', flag: codeToFlag('NO'), format: '406 12 345' },
  
  // O
  { code: 'OM', name: 'Oman', dial: '+968', flag: codeToFlag('OM'), format: '9212 3456' },
  
  // P
  { code: 'PK', name: 'Pakistan', dial: '+92', flag: codeToFlag('PK'), format: '300 1234567' },
  { code: 'PW', name: 'Palau', dial: '+680', flag: codeToFlag('PW'), format: '620 1234' },
  { code: 'PS', name: 'Palestine', dial: '+970', flag: codeToFlag('PS'), format: '599 123 456' },
  { code: 'PA', name: 'Panama', dial: '+507', flag: codeToFlag('PA'), format: '6123 4567' },
  { code: 'PG', name: 'Papua New Guinea', dial: '+675', flag: codeToFlag('PG'), format: '7012 3456' },
  { code: 'PY', name: 'Paraguay', dial: '+595', flag: codeToFlag('PY'), format: '961 456789' },
  { code: 'PE', name: 'Peru', dial: '+51', flag: codeToFlag('PE'), format: '912 345 678' },
  { code: 'PH', name: 'Philippines', dial: '+63', flag: codeToFlag('PH'), format: '905 123 4567' },
  { code: 'PL', name: 'Poland', dial: '+48', flag: codeToFlag('PL'), format: '512 345 678' },
  { code: 'PT', name: 'Portugal', dial: '+351', flag: codeToFlag('PT'), format: '912 345 678' },
  { code: 'PR', name: 'Puerto Rico', dial: '+1787', flag: codeToFlag('PR'), format: '787-234-5678' },
  
  // Q
  { code: 'QA', name: 'Qatar', dial: '+974', flag: codeToFlag('QA'), format: '3312 3456' },
  
  // R
  { code: 'RE', name: 'R—union', dial: '+262', flag: codeToFlag('RE'), format: '692 12 34 56' },
  { code: 'RO', name: 'Romania', dial: '+40', flag: codeToFlag('RO'), format: '712 034 567' },
  { code: 'RU', name: 'Russia', dial: '+7', flag: codeToFlag('RU'), format: '912 345-67-89' },
  { code: 'RW', name: 'Rwanda', dial: '+250', flag: codeToFlag('RW'), format: '720 123 456' },
  
  // S
  { code: 'BL', name: 'Saint Barth—lemy', dial: '+590', flag: codeToFlag('BL'), format: '690 30 12 34' },
  { code: 'SH', name: 'Saint Helena', dial: '+290', flag: codeToFlag('SH'), format: '51234' },
  { code: 'KN', name: 'Saint Kitts and Nevis', dial: '+1869', flag: codeToFlag('KN'), format: '765 1234' },
  { code: 'LC', name: 'Saint Lucia', dial: '+1758', flag: codeToFlag('LC'), format: '284 1234' },
  { code: 'MF', name: 'Saint Martin', dial: '+590', flag: codeToFlag('MF'), format: '690 30 12 34' },
  { code: 'PM', name: 'Saint Pierre and Miquelon', dial: '+508', flag: codeToFlag('PM'), format: '55 12 34' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines', dial: '+1784', flag: codeToFlag('VC'), format: '430 1234' },
  { code: 'WS', name: 'Samoa', dial: '+685', flag: codeToFlag('WS'), format: '72 12345' },
  { code: 'SM', name: 'San Marino', dial: '+378', flag: codeToFlag('SM'), format: '66 66 12 12' },
  { code: 'ST', name: 'S—o Tom— and Pr—ncipe', dial: '+239', flag: codeToFlag('ST'), format: '981 2345' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966', flag: codeToFlag('SA'), format: '50 123 4567' },
  { code: 'SN', name: 'Senegal', dial: '+221', flag: codeToFlag('SN'), format: '70 123 45 67' },
  { code: 'RS', name: 'Serbia', dial: '+381', flag: codeToFlag('RS'), format: '60 1234567' },
  { code: 'SC', name: 'Seychelles', dial: '+248', flag: codeToFlag('SC'), format: '2 510 123' },
  { code: 'SL', name: 'Sierra Leone', dial: '+232', flag: codeToFlag('SL'), format: '25 123456' },
  { code: 'SG', name: 'Singapore', dial: '+65', flag: codeToFlag('SG'), format: '8123 4567' },
  { code: 'SX', name: 'Sint Maarten', dial: '+1721', flag: codeToFlag('SX'), format: '520 1234' },
  { code: 'SK', name: 'Slovakia', dial: '+421', flag: codeToFlag('SK'), format: '912 123 456' },
  { code: 'SI', name: 'Slovenia', dial: '+386', flag: codeToFlag('SI'), format: '31 234 567' },
  { code: 'SB', name: 'Solomon Islands', dial: '+677', flag: codeToFlag('SB'), format: '74 21234' },
  { code: 'SO', name: 'Somalia', dial: '+252', flag: codeToFlag('SO'), format: '7 1123456' },
  { code: 'ZA', name: 'South Africa', dial: '+27', flag: codeToFlag('ZA'), format: '71 123 4567' },
  { code: 'KR', name: 'South Korea', dial: '+82', flag: codeToFlag('KR'), format: '10 1234 5678' },
  { code: 'SS', name: 'South Sudan', dial: '+211', flag: codeToFlag('SS'), format: '977 123 456' },
  { code: 'ES', name: 'Spain', dial: '+34', flag: codeToFlag('ES'), format: '612 34 56 78' },
  { code: 'LK', name: 'Sri Lanka', dial: '+94', flag: codeToFlag('LK'), format: '71 234 5678' },
  { code: 'SD', name: 'Sudan', dial: '+249', flag: codeToFlag('SD'), format: '91 123 1234' },
  { code: 'SR', name: 'Suriname', dial: '+597', flag: codeToFlag('SR'), format: '741 2345' },
  { code: 'SZ', name: 'Swaziland', dial: '+268', flag: codeToFlag('SZ'), format: '7612 3456' },
  { code: 'SE', name: 'Sweden', dial: '+46', flag: codeToFlag('SE'), format: '70 123 45 67' },
  { code: 'CH', name: 'Switzerland', dial: '+41', flag: codeToFlag('CH'), format: '78 123 45 67' },
  { code: 'SY', name: 'Syria', dial: '+963', flag: codeToFlag('SY'), format: '944 567 890' },
  
  // T
  { code: 'TW', name: 'Taiwan', dial: '+886', flag: codeToFlag('TW'), format: '912 345 678' },
  { code: 'TJ', name: 'Tajikistan', dial: '+992', flag: codeToFlag('TJ'), format: '917 12 3456' },
  { code: 'TZ', name: 'Tanzania', dial: '+255', flag: codeToFlag('TZ'), format: '621 234 567' },
  { code: 'TH', name: 'Thailand', dial: '+66', flag: codeToFlag('TH'), format: '81 234 5678' },
  { code: 'TL', name: 'Timor-Leste', dial: '+670', flag: codeToFlag('TL'), format: '7721 2345' },
  { code: 'TG', name: 'Togo', dial: '+228', flag: codeToFlag('TG'), format: '90 11 23 45' },
  { code: 'TK', name: 'Tokelau', dial: '+690', flag: codeToFlag('TK'), format: '7290' },
  { code: 'TO', name: 'Tonga', dial: '+676', flag: codeToFlag('TO'), format: '771 5123' },
  { code: 'TT', name: 'Trinidad and Tobago', dial: '+1868', flag: codeToFlag('TT'), format: '291 1234' },
  { code: 'TN', name: 'Tunisia', dial: '+216', flag: codeToFlag('TN'), format: '20 123 456' },
  { code: 'TR', name: 'Turkey', dial: '+90', flag: codeToFlag('TR'), format: '501 234 5678' },
  { code: 'TM', name: 'Turkmenistan', dial: '+993', flag: codeToFlag('TM'), format: '66 123456' },
  { code: 'TC', name: 'Turks and Caicos Islands', dial: '+1649', flag: codeToFlag('TC'), format: '231 1234' },
  { code: 'TV', name: 'Tuvalu', dial: '+688', flag: codeToFlag('TV'), format: '901234' },
  
  // U
  { code: 'UG', name: 'Uganda', dial: '+256', flag: codeToFlag('UG'), format: '712 345678' },
  { code: 'UA', name: 'Ukraine', dial: '+380', flag: codeToFlag('UA'), format: '50 123 4567' },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971', flag: codeToFlag('AE'), format: '50 123 4567' },
  { code: 'GB', name: 'United Kingdom', dial: '+44', flag: codeToFlag('GB'), format: '7700 900123' },
  { code: 'US', name: 'United States', dial: '+1', flag: codeToFlag('US'), format: '(415) 555-2671' },
  { code: 'UY', name: 'Uruguay', dial: '+598', flag: codeToFlag('UY'), format: '94 231 234' },
  { code: 'UZ', name: 'Uzbekistan', dial: '+998', flag: codeToFlag('UZ'), format: '91 234 56 78' },
  
  // V
  { code: 'VU', name: 'Vanuatu', dial: '+678', flag: codeToFlag('VU'), format: '591 2345' },
  { code: 'VA', name: 'Vatican City', dial: '+39', flag: codeToFlag('VA'), format: '312 345 6789' },
  { code: 'VE', name: 'Venezuela', dial: '+58', flag: codeToFlag('VE'), format: '412 1234567' },
  { code: 'VN', name: 'Vietnam', dial: '+84', flag: codeToFlag('VN'), format: '91 234 5678' },
  { code: 'VG', name: 'Virgin Islands (British)', dial: '+1284', flag: codeToFlag('VG'), format: '300 1234' },
  { code: 'VI', name: 'Virgin Islands (US)', dial: '+1340', flag: codeToFlag('VI'), format: '642 1234' },
  
  // W
  { code: 'WF', name: 'Wallis and Futuna', dial: '+681', flag: codeToFlag('WF'), format: '82 12 34' },
  
  // Y
  { code: 'YE', name: 'Yemen', dial: '+967', flag: codeToFlag('YE'), format: '712 345 678' },
  
  // Z
  { code: 'ZM', name: 'Zambia', dial: '+260', flag: codeToFlag('ZM'), format: '95 1234567' },
  { code: 'ZW', name: 'Zimbabwe', dial: '+263', flag: codeToFlag('ZW'), format: '71 234 5678' },
]

export default ALL_COUNTRY_CODES
