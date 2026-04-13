import { Cloud, Droplets, Wind, Thermometer, Eye, Gauge, Sun, CloudRain } from 'lucide-react'

const FORECAST = [
  { day: 'Today', icon: CloudRain, temp: '8°', desc: 'Heavy Rain', rain: '85%' },
  { day: 'Tue', icon: CloudRain, temp: '7°', desc: 'Showers', rain: '60%' },
  { day: 'Wed', icon: Cloud, temp: '9°', desc: 'Overcast', rain: '30%' },
  { day: 'Thu', icon: Sun, temp: '11°', desc: 'Partly Sunny', rain: '10%' },
  { day: 'Fri', icon: Cloud, temp: '10°', desc: 'Cloudy', rain: '25%' },
]

export default function WeatherPanel() {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold flex items-center gap-2">
          <Cloud className="w-4 h-4 text-blue-500" /> Weather — Aberdeen
        </h3>
        <span className="text-[10px] text-gray-500">Met Office</span>
      </div>

      {/* Current */}
      <div className="flex items-center gap-4">
        <div className="text-center">
          <CloudRain className="w-10 h-10 text-blue-500 mx-auto" />
          <p className="text-3xl font-bold mt-1">8°C</p>
          <p className="text-[10px] text-gray-500">Heavy Rain</p>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-2">
          {[
            { icon: Wind, label: 'Wind', value: '45 mph' },
            { icon: Droplets, label: 'Humidity', value: '92%' },
            { icon: Eye, label: 'Visibility', value: '2.1 km' },
            { icon: Gauge, label: 'Pressure', value: '998 hPa' },
          ].map(m => (
            <div key={m.label} className="flex items-center gap-1.5 p-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.02]">
              <m.icon className="w-3 h-3 text-gray-400" />
              <div>
                <p className="text-[9px] text-gray-400">{m.label}</p>
                <p className="text-[10px] font-bold">{m.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Forecast */}
      <div className="flex gap-1.5">
        {FORECAST.map(f => (
          <div key={f.day} className={`flex-1 text-center p-2 rounded-lg ${f.day === 'Today' ? 'bg-aegis-500/5 border border-aegis-500/10' : 'bg-gray-50 dark:bg-white/[0.02]'}`}>
            <p className="text-[9px] font-bold text-gray-500 dark:text-gray-400">{f.day}</p>
            <f.icon className="w-4 h-4 mx-auto my-1 text-blue-500" />
            <p className="text-xs font-bold">{f.temp}</p>
            <p className="text-[8px] text-blue-500">{f.rain}</p>
          </div>
        ))}
      </div>

      {/* Weather warnings */}
      <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
        <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 mb-0.5">⚠️ Met Office Yellow Warning</p>
        <p className="text-[10px] text-gray-600 dark:text-gray-400">Heavy rain expected 14:00–22:00. Potential flooding in low-lying areas. 40-60mm anticipated.</p>
      </div>
    </div>
  )
}
