/**
 * Comprehensive country codes for international phone numbers
 * All 195 UN-recognized countries + territories
 * E.164 format support
 */

export interface CountryCode {
  code: string // ISO 3166-1 alpha-2
  name: string
  dial: string // International dialing code
  flag: string // Emoji flag
  format: string // Example phone number format
}

export const ALL_COUNTRY_CODES: CountryCode[] = [
  // A
  { code: 'AF', name: 'Afghanistan', dial: '+93', flag: '🇦🇫', format: '70 123 4567' },
  { code: 'AL', name: 'Albania', dial: '+355', flag: '🇦🇱', format: '66 123 4567' },
  { code: 'DZ', name: 'Algeria', dial: '+213', flag: '🇩🇿', format: '551 23 45 67' },
  { code: 'AS', name: 'American Samoa', dial: '+1684', flag: '🇦🇸', format: '733 1234' },
  { code: 'AD', name: 'Andorra', dial: '+376', flag: '🇦🇩', format: '312 345' },
  { code: 'AO', name: 'Angola', dial: '+244', flag: '🇦🇴', format: '923 123 456' },
  { code: 'AI', name: 'Anguilla', dial: '+1264', flag: '🇦🇮', format: '235 1234' },
  { code: 'AG', name: 'Antigua and Barbuda', dial: '+1268', flag: '🇦🇬', format: '464 1234' },
  { code: 'AR', name: 'Argentina', dial: '+54', flag: '🇦🇷', format: '11 2345-6789' },
  { code: 'AM', name: 'Armenia', dial: '+374', flag: '🇦🇲', format: '77 123456' },
  { code: 'AW', name: 'Aruba', dial: '+297', flag: '🇦🇼', format: '560 1234' },
  { code: 'AU', name: 'Australia', dial: '+61', flag: '🇦🇺', format: '412 345 678' },
  { code: 'AT', name: 'Austria', dial: '+43', flag: '🇦🇹', format: '664 123456' },
  { code: 'AZ', name: 'Azerbaijan', dial: '+994', flag: '🇦🇿', format: '40 123 45 67' },
  
  // B
  { code: 'BS', name: 'Bahamas', dial: '+1242', flag: '🇧🇸', format: '359 1234' },
  { code: 'BH', name: 'Bahrain', dial: '+973', flag: '🇧🇭', format: '3600 1234' },
  { code: 'BD', name: 'Bangladesh', dial: '+880', flag: '🇧🇩', format: '1812 345678' },
  { code: 'BB', name: 'Barbados', dial: '+1246', flag: '🇧🇧', format: '250 1234' },
  { code: 'BY', name: 'Belarus', dial: '+375', flag: '🇧🇾', format: '29 123 45 67' },
  { code: 'BE', name: 'Belgium', dial: '+32', flag: '🇧🇪', format: '470 12 34 56' },
  { code: 'BZ', name: 'Belize', dial: '+501', flag: '🇧🇿', format: '622 1234' },
  { code: 'BJ', name: 'Benin', dial: '+229', flag: '🇧🇯', format: '90 01 12 34' },
  { code: 'BM', name: 'Bermuda', dial: '+1441', flag: '🇧🇲', format: '370 1234' },
  { code: 'BT', name: 'Bhutan', dial: '+975', flag: '🇧🇹', format: '17 12 34 56' },
  { code: 'BO', name: 'Bolivia', dial: '+591', flag: '🇧🇴', format: '7123 4567' },
  { code: 'BA', name: 'Bosnia and Herzegovina', dial: '+387', flag: '🇧🇦', format: '61 123 456' },
  { code: 'BW', name: 'Botswana', dial: '+267', flag: '🇧🇼', format: '71 123 456' },
  { code: 'BR', name: 'Brazil', dial: '+55', flag: '🇧🇷', format: '11 91234-5678' },
  { code: 'BN', name: 'Brunei', dial: '+673', flag: '🇧🇳', format: '712 3456' },
  { code: 'BG', name: 'Bulgaria', dial: '+359', flag: '🇧🇬', format: '87 123 4567' },
  { code: 'BF', name: 'Burkina Faso', dial: '+226', flag: '🇧🇫', format: '70 12 34 56' },
  { code: 'BI', name: 'Burundi', dial: '+257', flag: '🇧🇮', format: '79 56 12 34' },
  
  // C
  { code: 'KH', name: 'Cambodia', dial: '+855', flag: '🇰🇭', format: '91 234 567' },
  { code: 'CM', name: 'Cameroon', dial: '+237', flag: '🇨🇲', format: '6 71 23 45 67' },
  { code: 'CA', name: 'Canada', dial: '+1', flag: '🇨🇦', format: '(416) 555-1234' },
  { code: 'CV', name: 'Cape Verde', dial: '+238', flag: '🇨🇻', format: '991 12 34' },
  { code: 'KY', name: 'Cayman Islands', dial: '+1345', flag: '🇰🇾', format: '323 1234' },
  { code: 'CF', name: 'Central African Republic', dial: '+236', flag: '🇨🇫', format: '70 01 23 45' },
  { code: 'TD', name: 'Chad', dial: '+235', flag: '🇹🇩', format: '63 01 23 45' },
  { code: 'CL', name: 'Chile', dial: '+56', flag: '🇨🇱', format: '9 1234 5678' },
  { code: 'CN', name: 'China', dial: '+86', flag: '🇨🇳', format: '131 2345 6789' },
  { code: 'CO', name: 'Colombia', dial: '+57', flag: '🇨🇴', format: '312 3456789' },
  { code: 'KM', name: 'Comoros', dial: '+269', flag: '🇰🇲', format: '321 23 45' },
  { code: 'CG', name: 'Congo', dial: '+242', flag: '🇨🇬', format: '06 123 4567' },
  { code: 'CD', name: 'Congo (DRC)', dial: '+243', flag: '🇨🇩', format: '991 234 567' },
  { code: 'CK', name: 'Cook Islands', dial: '+682', flag: '🇨🇰', format: '71 234' },
  { code: 'CR', name: 'Costa Rica', dial: '+506', flag: '🇨🇷', format: '8312 3456' },
  { code: 'HR', name: 'Croatia', dial: '+385', flag: '🇭🇷', format: '91 234 5678' },
  { code: 'CU', name: 'Cuba', dial: '+53', flag: '🇨🇺', format: '5 1234567' },
  { code: 'CW', name: 'Curaçao', dial: '+599', flag: '🇨🇼', format: '9 518 1234' },
  { code: 'CY', name: 'Cyprus', dial: '+357', flag: '🇨🇾', format: '96 123456' },
  { code: 'CZ', name: 'Czech Republic', dial: '+420', flag: '🇨🇿', format: '601 123 456' },
  
  // D
  { code: 'DK', name: 'Denmark', dial: '+45', flag: '🇩🇰', format: '32 12 34 56' },
  { code: 'DJ', name: 'Djibouti', dial: '+253', flag: '🇩🇯', format: '77 83 10 01' },
  { code: 'DM', name: 'Dominica', dial: '+1767', flag: '🇩🇲', format: '225 1234' },
  { code: 'DO', name: 'Dominican Republic', dial: '+1809', flag: '🇩🇴', format: '809-234-5678' },
  
  // E
  { code: 'EC', name: 'Ecuador', dial: '+593', flag: '🇪🇨', format: '99 123 4567' },
  { code: 'EG', name: 'Egypt', dial: '+20', flag: '🇪🇬', format: '100 123 4567' },
  { code: 'SV', name: 'El Salvador', dial: '+503', flag: '🇸🇻', format: '7012 3456' },
  { code: 'GQ', name: 'Equatorial Guinea', dial: '+240', flag: '🇬🇶', format: '222 123 456' },
  { code: 'ER', name: 'Eritrea', dial: '+291', flag: '🇪🇷', format: '7 123 456' },
  { code: 'EE', name: 'Estonia', dial: '+372', flag: '🇪🇪', format: '5123 4567' },
  { code: 'ET', name: 'Ethiopia', dial: '+251', flag: '🇪🇹', format: '91 123 4567' },
  
  // F
  { code: 'FJ', name: 'Fiji', dial: '+679', flag: '🇫🇯', format: '701 2345' },
  { code: 'FI', name: 'Finland', dial: '+358', flag: '🇫🇮', format: '40 123 4567' },
  { code: 'FR', name: 'France', dial: '+33', flag: '🇫🇷', format: '6 12 34 56 78' },
  { code: 'GF', name: 'French Guiana', dial: '+594', flag: '🇬🇫', format: '694 20 12 34' },
  { code: 'PF', name: 'French Polynesia', dial: '+689', flag: '🇵🇫', format: '87 12 34 56' },
  
  // G
  { code: 'GA', name: 'Gabon', dial: '+241', flag: '🇬🇦', format: '06 03 12 34' },
  { code: 'GM', name: 'Gambia', dial: '+220', flag: '🇬🇲', format: '301 2345' },
  { code: 'GE', name: 'Georgia', dial: '+995', flag: '🇬🇪', format: '555 12 34 56' },
  { code: 'DE', name: 'Germany', dial: '+49', flag: '🇩🇪', format: '151 23456789' },
  { code: 'GH', name: 'Ghana', dial: '+233', flag: '🇬🇭', format: '23 123 4567' },
  { code: 'GI', name: 'Gibraltar', dial: '+350', flag: '🇬🇮', format: '57123456' },
  { code: 'GR', name: 'Greece', dial: '+30', flag: '🇬🇷', format: '691 234 5678' },
  { code: 'GL', name: 'Greenland', dial: '+299', flag: '🇬🇱', format: '22 12 34' },
  { code: 'GD', name: 'Grenada', dial: '+1473', flag: '🇬🇩', format: '403 1234' },
  { code: 'GP', name: 'Guadeloupe', dial: '+590', flag: '🇬🇵', format: '690 30 12 34' },
  { code: 'GU', name: 'Guam', dial: '+1671', flag: '🇬🇺', format: '300 1234' },
  { code: 'GT', name: 'Guatemala', dial: '+502', flag: '🇬🇹', format: '5123 4567' },
  { code: 'GN', name: 'Guinea', dial: '+224', flag: '🇬🇳', format: '601 12 34 56' },
  { code: 'GW', name: 'Guinea-Bissau', dial: '+245', flag: '🇬🇼', format: '955 012 345' },
  { code: 'GY', name: 'Guyana', dial: '+592', flag: '🇬🇾', format: '609 1234' },
  
  // H
  { code: 'HT', name: 'Haiti', dial: '+509', flag: '🇭🇹', format: '34 10 1234' },
  { code: 'HN', name: 'Honduras', dial: '+504', flag: '🇭🇳', format: '9123 4567' },
  { code: 'HK', name: 'Hong Kong', dial: '+852', flag: '🇭🇰', format: '5123 4567' },
  { code: 'HU', name: 'Hungary', dial: '+36', flag: '🇭🇺', format: '20 123 4567' },
  
  // I
  { code: 'IS', name: 'Iceland', dial: '+354', flag: '🇮🇸', format: '611 1234' },
  { code: 'IN', name: 'India', dial: '+91', flag: '🇮🇳', format: '81234 56789' },
  { code: 'ID', name: 'Indonesia', dial: '+62', flag: '🇮🇩', format: '812 3456 7890' },
  { code: 'IR', name: 'Iran', dial: '+98', flag: '🇮🇷', format: '912 345 6789' },
  { code: 'IQ', name: 'Iraq', dial: '+964', flag: '🇮🇶', format: '791 234 5678' },
  { code: 'IE', name: 'Ireland', dial: '+353', flag: '🇮🇪', format: '85 123 4567' },
  { code: 'IL', name: 'Israel', dial: '+972', flag: '🇮🇱', format: '50 123 4567' },
  { code: 'IT', name: 'Italy', dial: '+39', flag: '🇮🇹', format: '312 345 6789' },
  { code: 'CI', name: 'Ivory Coast', dial: '+225', flag: '🇨🇮', format: '01 23 45 67' },
  
  // J
  { code: 'JM', name: 'Jamaica', dial: '+1876', flag: '🇯🇲', format: '210 1234' },
  { code: 'JP', name: 'Japan', dial: '+81', flag: '🇯🇵', format: '90 1234 5678' },
  { code: 'JO', name: 'Jordan', dial: '+962', flag: '🇯🇴', format: '7 9012 3456' },
  
  // K
  { code: 'KZ', name: 'Kazakhstan', dial: '+7', flag: '🇰🇿', format: '771 000 9998' },
  { code: 'KE', name: 'Kenya', dial: '+254', flag: '🇰🇪', format: '712 345678' },
  { code: 'KI', name: 'Kiribati', dial: '+686', flag: '🇰🇮', format: '72012345' },
  { code: 'XK', name: 'Kosovo', dial: '+383', flag: '🇽🇰', format: '43 201 234' },
  { code: 'KW', name: 'Kuwait', dial: '+965', flag: '🇰🇼', format: '500 12345' },
  { code: 'KG', name: 'Kyrgyzstan', dial: '+996', flag: '🇰🇬', format: '700 123 456' },
  
  // L
  { code: 'LA', name: 'Laos', dial: '+856', flag: '🇱🇦', format: '20 23 123 456' },
  { code: 'LV', name: 'Latvia', dial: '+371', flag: '🇱🇻', format: '21 234 567' },
  { code: 'LB', name: 'Lebanon', dial: '+961', flag: '🇱🇧', format: '71 123 456' },
  { code: 'LS', name: 'Lesotho', dial: '+266', flag: '🇱🇸', format: '5012 3456' },
  { code: 'LR', name: 'Liberia', dial: '+231', flag: '🇱🇷', format: '77 012 3456' },
  { code: 'LY', name: 'Libya', dial: '+218', flag: '🇱🇾', format: '91 2345678' },
  { code: 'LI', name: 'Liechtenstein', dial: '+423', flag: '🇱🇮', format: '660 234 567' },
  { code: 'LT', name: 'Lithuania', dial: '+370', flag: '🇱🇹', format: '612 34567' },
  { code: 'LU', name: 'Luxembourg', dial: '+352', flag: '🇱🇺', format: '628 123 456' },
  
  // M
  { code: 'MO', name: 'Macau', dial: '+853', flag: '🇲🇴', format: '6612 3456' },
  { code: 'MK', name: 'Macedonia', dial: '+389', flag: '🇲🇰', format: '72 345 678' },
  { code: 'MG', name: 'Madagascar', dial: '+261', flag: '🇲🇬', format: '32 12 345 67' },
  { code: 'MW', name: 'Malawi', dial: '+265', flag: '🇲🇼', format: '991 23 45 67' },
  { code: 'MY', name: 'Malaysia', dial: '+60', flag: '🇲🇾', format: '12 345 6789' },
  { code: 'MV', name: 'Maldives', dial: '+960', flag: '🇲🇻', format: '771 2345' },
  { code: 'ML', name: 'Mali', dial: '+223', flag: '🇲🇱', format: '65 01 23 45' },
  { code: 'MT', name: 'Malta', dial: '+356', flag: '🇲🇹', format: '9696 1234' },
  { code: 'MH', name: 'Marshall Islands', dial: '+692', flag: '🇲🇭', format: '235 1234' },
  { code: 'MQ', name: 'Martinique', dial: '+596', flag: '🇲🇶', format: '696 20 12 34' },
  { code: 'MR', name: 'Mauritania', dial: '+222', flag: '🇲🇷', format: '22 12 34 56' },
  { code: 'MU', name: 'Mauritius', dial: '+230', flag: '🇲🇺', format: '5251 2345' },
  { code: 'YT', name: 'Mayotte', dial: '+262', flag: '🇾🇹', format: '639 01 23 45' },
  { code: 'MX', name: 'Mexico', dial: '+52', flag: '🇲🇽', format: '55 1234 5678' },
  { code: 'FM', name: 'Micronesia', dial: '+691', flag: '🇫🇲', format: '350 1234' },
  { code: 'MD', name: 'Moldova', dial: '+373', flag: '🇲🇩', format: '621 12 345' },
  { code: 'MC', name: 'Monaco', dial: '+377', flag: '🇲🇨', format: '6 12 34 56 78' },
  { code: 'MN', name: 'Mongolia', dial: '+976', flag: '🇲🇳', format: '8812 3456' },
  { code: 'ME', name: 'Montenegro', dial: '+382', flag: '🇲🇪', format: '67 622 901' },
  { code: 'MS', name: 'Montserrat', dial: '+1664', flag: '🇲🇸', format: '492 1234' },
  { code: 'MA', name: 'Morocco', dial: '+212', flag: '🇲🇦', format: '650 123456' },
  { code: 'MZ', name: 'Mozambique', dial: '+258', flag: '🇲🇿', format: '82 123 4567' },
  { code: 'MM', name: 'Myanmar', dial: '+95', flag: '🇲🇲', format: '9 212 3456' },
  
  // N
  { code: 'NA', name: 'Namibia', dial: '+264', flag: '🇳🇦', format: '81 123 4567' },
  { code: 'NR', name: 'Nauru', dial: '+674', flag: '🇳🇷', format: '555 1234' },
  { code: 'NP', name: 'Nepal', dial: '+977', flag: '🇳🇵', format: '984 1234567' },
  { code: 'NL', name: 'Netherlands', dial: '+31', flag: '🇳🇱', format: '6 12345678' },
  { code: 'NC', name: 'New Caledonia', dial: '+687', flag: '🇳🇨', format: '75 12 34' },
  { code: 'NZ', name: 'New Zealand', dial: '+64', flag: '🇳🇿', format: '21 123 4567' },
  { code: 'NI', name: 'Nicaragua', dial: '+505', flag: '🇳🇮', format: '8123 4567' },
  { code: 'NE', name: 'Niger', dial: '+227', flag: '🇳🇪', format: '93 12 34 56' },
  { code: 'NG', name: 'Nigeria', dial: '+234', flag: '🇳🇬', format: '802 123 4567' },
  { code: 'NU', name: 'Niue', dial: '+683', flag: '🇳🇺', format: '1234' },
  { code: 'KP', name: 'North Korea', dial: '+850', flag: '🇰🇵', format: '192 123 4567' },
  { code: 'NO', name: 'Norway', dial: '+47', flag: '🇳🇴', format: '406 12 345' },
  
  // O
  { code: 'OM', name: 'Oman', dial: '+968', flag: '🇴🇲', format: '9212 3456' },
  
  // P
  { code: 'PK', name: 'Pakistan', dial: '+92', flag: '🇵🇰', format: '300 1234567' },
  { code: 'PW', name: 'Palau', dial: '+680', flag: '🇵🇼', format: '620 1234' },
  { code: 'PS', name: 'Palestine', dial: '+970', flag: '🇵🇸', format: '599 123 456' },
  { code: 'PA', name: 'Panama', dial: '+507', flag: '🇵🇦', format: '6123 4567' },
  { code: 'PG', name: 'Papua New Guinea', dial: '+675', flag: '🇵🇬', format: '7012 3456' },
  { code: 'PY', name: 'Paraguay', dial: '+595', flag: '🇵🇾', format: '961 456789' },
  { code: 'PE', name: 'Peru', dial: '+51', flag: '🇵🇪', format: '912 345 678' },
  { code: 'PH', name: 'Philippines', dial: '+63', flag: '🇵🇭', format: '905 123 4567' },
  { code: 'PL', name: 'Poland', dial: '+48', flag: '🇵🇱', format: '512 345 678' },
  { code: 'PT', name: 'Portugal', dial: '+351', flag: '🇵🇹', format: '912 345 678' },
  { code: 'PR', name: 'Puerto Rico', dial: '+1787', flag: '🇵🇷', format: '787-234-5678' },
  
  // Q
  { code: 'QA', name: 'Qatar', dial: '+974', flag: '🇶🇦', format: '3312 3456' },
  
  // R
  { code: 'RE', name: 'Réunion', dial: '+262', flag: '🇷🇪', format: '692 12 34 56' },
  { code: 'RO', name: 'Romania', dial: '+40', flag: '🇷🇴', format: '712 034 567' },
  { code: 'RU', name: 'Russia', dial: '+7', flag: '🇷🇺', format: '912 345-67-89' },
  { code: 'RW', name: 'Rwanda', dial: '+250', flag: '🇷🇼', format: '720 123 456' },
  
  // S
  { code: 'BL', name: 'Saint Barthélemy', dial: '+590', flag: '🇧🇱', format: '690 30 12 34' },
  { code: 'SH', name: 'Saint Helena', dial: '+290', flag: '🇸🇭', format: '51234' },
  { code: 'KN', name: 'Saint Kitts and Nevis', dial: '+1869', flag: '🇰🇳', format: '765 1234' },
  { code: 'LC', name: 'Saint Lucia', dial: '+1758', flag: '🇱🇨', format: '284 1234' },
  { code: 'MF', name: 'Saint Martin', dial: '+590', flag: '🇲🇫', format: '690 30 12 34' },
  { code: 'PM', name: 'Saint Pierre and Miquelon', dial: '+508', flag: '🇵🇲', format: '55 12 34' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines', dial: '+1784', flag: '🇻🇨', format: '430 1234' },
  { code: 'WS', name: 'Samoa', dial: '+685', flag: '🇼🇸', format: '72 12345' },
  { code: 'SM', name: 'San Marino', dial: '+378', flag: '🇸🇲', format: '66 66 12 12' },
  { code: 'ST', name: 'São Tomé and Príncipe', dial: '+239', flag: '🇸🇹', format: '981 2345' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966', flag: '🇸🇦', format: '50 123 4567' },
  { code: 'SN', name: 'Senegal', dial: '+221', flag: '🇸🇳', format: '70 123 45 67' },
  { code: 'RS', name: 'Serbia', dial: '+381', flag: '🇷🇸', format: '60 1234567' },
  { code: 'SC', name: 'Seychelles', dial: '+248', flag: '🇸🇨', format: '2 510 123' },
  { code: 'SL', name: 'Sierra Leone', dial: '+232', flag: '🇸🇱', format: '25 123456' },
  { code: 'SG', name: 'Singapore', dial: '+65', flag: '🇸🇬', format: '8123 4567' },
  { code: 'SX', name: 'Sint Maarten', dial: '+1721', flag: '🇸🇽', format: '520 1234' },
  { code: 'SK', name: 'Slovakia', dial: '+421', flag: '🇸🇰', format: '912 123 456' },
  { code: 'SI', name: 'Slovenia', dial: '+386', flag: '🇸🇮', format: '31 234 567' },
  { code: 'SB', name: 'Solomon Islands', dial: '+677', flag: '🇸🇧', format: '74 21234' },
  { code: 'SO', name: 'Somalia', dial: '+252', flag: '🇸🇴', format: '7 1123456' },
  { code: 'ZA', name: 'South Africa', dial: '+27', flag: '🇿🇦', format: '71 123 4567' },
  { code: 'KR', name: 'South Korea', dial: '+82', flag: '🇰🇷', format: '10 1234 5678' },
  { code: 'SS', name: 'South Sudan', dial: '+211', flag: '🇸🇸', format: '977 123 456' },
  { code: 'ES', name: 'Spain', dial: '+34', flag: '🇪🇸', format: '612 34 56 78' },
  { code: 'LK', name: 'Sri Lanka', dial: '+94', flag: '🇱🇰', format: '71 234 5678' },
  { code: 'SD', name: 'Sudan', dial: '+249', flag: '🇸🇩', format: '91 123 1234' },
  { code: 'SR', name: 'Suriname', dial: '+597', flag: '🇸🇷', format: '741 2345' },
  { code: 'SZ', name: 'Swaziland', dial: '+268', flag: '🇸🇿', format: '7612 3456' },
  { code: 'SE', name: 'Sweden', dial: '+46', flag: '🇸🇪', format: '70 123 45 67' },
  { code: 'CH', name: 'Switzerland', dial: '+41', flag: '🇨🇭', format: '78 123 45 67' },
  { code: 'SY', name: 'Syria', dial: '+963', flag: '🇸🇾', format: '944 567 890' },
  
  // T
  { code: 'TW', name: 'Taiwan', dial: '+886', flag: '🇹🇼', format: '912 345 678' },
  { code: 'TJ', name: 'Tajikistan', dial: '+992', flag: '🇹🇯', format: '917 12 3456' },
  { code: 'TZ', name: 'Tanzania', dial: '+255', flag: '🇹🇿', format: '621 234 567' },
  { code: 'TH', name: 'Thailand', dial: '+66', flag: '🇹🇭', format: '81 234 5678' },
  { code: 'TL', name: 'Timor-Leste', dial: '+670', flag: '🇹🇱', format: '7721 2345' },
  { code: 'TG', name: 'Togo', dial: '+228', flag: '🇹🇬', format: '90 11 23 45' },
  { code: 'TK', name: 'Tokelau', dial: '+690', flag: '🇹🇰', format: '7290' },
  { code: 'TO', name: 'Tonga', dial: '+676', flag: '🇹🇴', format: '771 5123' },
  { code: 'TT', name: 'Trinidad and Tobago', dial: '+1868', flag: '🇹🇹', format: '291 1234' },
  { code: 'TN', name: 'Tunisia', dial: '+216', flag: '🇹🇳', format: '20 123 456' },
  { code: 'TR', name: 'Turkey', dial: '+90', flag: '🇹🇷', format: '501 234 5678' },
  { code: 'TM', name: 'Turkmenistan', dial: '+993', flag: '🇹🇲', format: '66 123456' },
  { code: 'TC', name: 'Turks and Caicos Islands', dial: '+1649', flag: '🇹🇨', format: '231 1234' },
  { code: 'TV', name: 'Tuvalu', dial: '+688', flag: '🇹🇻', format: '901234' },
  
  // U
  { code: 'UG', name: 'Uganda', dial: '+256', flag: '🇺🇬', format: '712 345678' },
  { code: 'UA', name: 'Ukraine', dial: '+380', flag: '🇺🇦', format: '50 123 4567' },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971', flag: '🇦🇪', format: '50 123 4567' },
  { code: 'GB', name: 'United Kingdom', dial: '+44', flag: '🇬🇧', format: '7700 900123' },
  { code: 'US', name: 'United States', dial: '+1', flag: '🇺🇸', format: '(415) 555-2671' },
  { code: 'UY', name: 'Uruguay', dial: '+598', flag: '🇺🇾', format: '94 231 234' },
  { code: 'UZ', name: 'Uzbekistan', dial: '+998', flag: '🇺🇿', format: '91 234 56 78' },
  
  // V
  { code: 'VU', name: 'Vanuatu', dial: '+678', flag: '🇻🇺', format: '591 2345' },
  { code: 'VA', name: 'Vatican City', dial: '+39', flag: '🇻🇦', format: '312 345 6789' },
  { code: 'VE', name: 'Venezuela', dial: '+58', flag: '🇻🇪', format: '412 1234567' },
  { code: 'VN', name: 'Vietnam', dial: '+84', flag: '🇻🇳', format: '91 234 5678' },
  { code: 'VG', name: 'Virgin Islands (British)', dial: '+1284', flag: '🇻🇬', format: '300 1234' },
  { code: 'VI', name: 'Virgin Islands (US)', dial: '+1340', flag: '🇻🇮', format: '642 1234' },
  
  // W
  { code: 'WF', name: 'Wallis and Futuna', dial: '+681', flag: '🇼🇫', format: '82 12 34' },
  
  // Y
  { code: 'YE', name: 'Yemen', dial: '+967', flag: '🇾🇪', format: '712 345 678' },
  
  // Z
  { code: 'ZM', name: 'Zambia', dial: '+260', flag: '🇿🇲', format: '95 1234567' },
  { code: 'ZW', name: 'Zimbabwe', dial: '+263', flag: '🇿🇼', format: '71 234 5678' },
]

export default ALL_COUNTRY_CODES
