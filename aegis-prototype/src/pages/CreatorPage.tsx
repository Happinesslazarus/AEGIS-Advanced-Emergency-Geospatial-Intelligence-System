import { Navbar } from '../components/Navbar'
import Footer from '../components/Footer'
import { Shield, Heart, GraduationCap, Github, Linkedin, Globe, Code, Brain, Database, Layout, MapPin, Server } from 'lucide-react'
import { Link } from 'react-router-dom'

const TECH_STACK = [
  { category: 'Frontend', items: ['React 18 + TypeScript', 'Tailwind CSS + DM Sans', 'Vite (HMR)', 'Leaflet + Deck.gl', 'Socket.IO Client', 'i18next (9 languages)'], icon: Layout, color: 'text-blue-500' },
  { category: 'Backend', items: ['Node.js + Express', 'PostgreSQL + Sequelize', 'Socket.IO (real-time)', 'JWT Authentication', 'Multer (file uploads)', 'Nodemailer + Twilio'], icon: Server, color: 'text-green-500' },
  { category: 'AI Engine', items: ['Python + FastAPI', 'scikit-learn + TF-IDF', 'NLP Classification', 'Fake Report Detection', 'Severity Assessment', 'Ollama (Gemma3 LLM)'], icon: Brain, color: 'text-purple-500' },
  { category: 'Data', items: ['Environment Agency API', 'SEPA Scotland API', 'Met Office Feeds', 'OpenStreetMap', 'GeoJSON Boundaries', 'GDACS + USGS'], icon: Database, color: 'text-amber-500' },
]

export default function CreatorPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-aegis-100/40 dark:from-gray-950 dark:via-gray-900 dark:to-aegis-950/30 text-gray-900 dark:text-gray-100">
      <Navbar />
      <main className="pt-20 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-12">
          {/* Hero */}
          <section className="text-center space-y-4">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-aegis-500 via-blue-600 to-purple-600 flex items-center justify-center mx-auto shadow-xl shadow-aegis-500/20">
              <Heart className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold">Built with <span className="gradient-text">Passion</span></h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-lg mx-auto">AEGIS was created as a BSc Honours project at Robert Gordon University, Aberdeen, driven by a passion for using technology to protect communities.</p>
          </section>

          {/* Creator */}
          <section className="card p-8 text-center">
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-aegis-500 to-purple-600 flex items-center justify-center mx-auto mb-4 text-4xl shadow-lg">
              👩‍💻
            </div>
            <h2 className="text-xl font-bold mb-1">Happiness Ada Lazarus</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">BSc (Hons) Computing · Robert Gordon University</p>
            <div className="flex items-center justify-center gap-2 mb-6">
              <span className="badge bg-aegis-50 dark:bg-aegis-500/10 text-aegis-600 dark:text-aegis-400">Full-Stack Developer</span>
              <span className="badge bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400">AI/ML Engineer</span>
              <span className="badge bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400">UX Designer</span>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed max-w-lg mx-auto">
              Designed and built every aspect of AEGIS — from the AI classification engine and real-time backend to the responsive frontend and geospatial mapping system. Passionate about leveraging technology for social good and disaster resilience.
            </p>
          </section>

          {/* Supervisor */}
          <section className="card p-6 border-l-4 border-aegis-500">
            <div className="flex items-start gap-3">
              <GraduationCap className="w-6 h-6 text-aegis-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold mb-1">Academic Supervisor</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">Dr. Eyad Elyan — School of Computing, Robert Gordon University. Specialising in AI, Computer Vision, and Machine Learning applications.</p>
              </div>
            </div>
          </section>

          {/* Technology */}
          <section>
            <h2 className="text-lg font-bold mb-6 text-center">Technology Stack</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {TECH_STACK.map(t => (
                <div key={t.category} className="card p-5">
                  <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
                    <t.icon className={`w-4 h-4 ${t.color}`} /> {t.category}
                  </h3>
                  <ul className="space-y-1.5">
                    {t.items.map(i => (
                      <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-aegis-500" /> {i}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Stats */}
          <section className="card p-6">
            <h2 className="text-sm font-bold mb-4 text-center">Project Metrics</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              {[
                { label: 'Lines of Code', value: '50K+' },
                { label: 'React Components', value: '80+' },
                { label: 'API Endpoints', value: '45+' },
                { label: 'ML Models', value: '5' },
              ].map(m => (
                <div key={m.label} className="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02]">
                  <p className="text-2xl font-bold text-aegis-500">{m.value}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="text-center space-y-4">
            <h2 className="text-xl font-bold">Explore the Platform</h2>
            <div className="flex justify-center gap-3">
              <Link to="/guest" className="btn-primary text-sm px-6 py-3">View Dashboard</Link>
              <Link to="/about" className="px-6 py-3 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                About AEGIS
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  )
}
