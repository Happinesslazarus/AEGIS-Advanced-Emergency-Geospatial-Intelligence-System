import { Navbar } from '../components/Navbar'
import Footer from '../components/Footer'
import { Shield, Users, Brain, Globe, MapPin, Cpu, BarChart3, Heart, ChevronRight, GraduationCap } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-aegis-100/40 dark:from-gray-950 dark:via-gray-900 dark:to-aegis-950/30 text-gray-900 dark:text-gray-100">
      <Navbar />

      <main className="pt-20 pb-16">
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 space-y-16">
          {/* Hero */}
          <section className="text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-aegis-500 to-blue-600 flex items-center justify-center mx-auto">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold">About <span className="gradient-text">AEGIS</span></h1>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto text-sm leading-relaxed">
              <strong>AI-Enhanced Geospatial Intelligence System</strong> — A next-generation disaster management platform combining artificial intelligence, real-time geospatial data, and community engagement to protect lives and empower communities during emergencies.
            </p>
          </section>

          {/* Mission */}
          <section className="card p-8">
            <h2 className="text-lg font-bold mb-3">Our Mission</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              AEGIS was designed to bridge the gap between citizens and emergency responders during natural disasters. By leveraging machine learning for disaster classification, real-time geospatial mapping, and community-driven reporting, AEGIS provides a comprehensive ecosystem that enhances situational awareness, accelerates response times, and ultimately saves lives.
            </p>
          </section>

          {/* Core Capabilities */}
          <section>
            <h2 className="text-lg font-bold mb-6 text-center">Core Capabilities</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { icon: Brain, title: 'AI-Powered Classification', desc: 'Machine learning models classify disaster reports with 94%+ accuracy, enabling rapid triage and response prioritisation.' },
                { icon: MapPin, title: 'Real-Time Geospatial Mapping', desc: 'Interactive Leaflet-based maps display live incident reports, safe zones, shelters, and resource deployment.' },
                { icon: Users, title: 'Community Reporting', desc: 'Citizens submit geo-tagged disaster reports with images, creating a crowd-sourced intelligence network.' },
                { icon: BarChart3, title: 'Analytics Dashboard', desc: 'Comprehensive analytics for operators — trend analysis, model performance metrics, and resource allocation insights.' },
                { icon: Globe, title: 'Multi-Source Data Integration', desc: 'Aggregates data from USGS, GDACS, OpenWeather, and community reports into a unified intelligence picture.' },
                { icon: Cpu, title: 'Automated Alert System', desc: 'AI generates and broadcasts graduated alerts based on severity, location, and predicted impact.' },
              ].map(c => (
                <div key={c.title} className="card p-5">
                  <c.icon className="w-6 h-6 text-aegis-500 mb-3" />
                  <h3 className="font-bold text-sm mb-1">{c.title}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{c.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Tech Stack */}
          <section className="card p-8">
            <h2 className="text-lg font-bold mb-4">Technology Stack</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Frontend', items: ['React 18', 'TypeScript', 'Tailwind CSS', 'Vite'] },
                { label: 'Backend', items: ['Node.js', 'Express', 'PostgreSQL', 'Socket.IO'] },
                { label: 'AI Engine', items: ['Python', 'scikit-learn', 'TF-IDF', 'FastAPI'] },
                { label: 'Data Sources', items: ['USGS', 'GDACS', 'OpenWeather', 'Leaflet'] },
              ].map(s => (
                <div key={s.label}>
                  <h4 className="text-xs font-bold text-aegis-500 mb-2">{s.label}</h4>
                  <ul className="space-y-1">
                    {s.items.map(i => (
                      <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-aegis-500" /> {i}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Academic Context */}
          <section className="card p-8 border-l-4 border-aegis-500">
            <div className="flex items-start gap-3">
              <GraduationCap className="w-6 h-6 text-aegis-500 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-lg font-bold mb-2">Academic Project</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  AEGIS was developed as an Honours Year Project at Robert Gordon University, Aberdeen. The system demonstrates the practical application of AI and geospatial technologies in disaster management, with a focus on the Aberdeen and Aberdeenshire region.
                </p>
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="text-center space-y-4">
            <h2 className="text-xl font-bold">Ready to explore AEGIS?</h2>
            <div className="flex justify-center gap-3">
              <Link to="/guest" className="btn-primary text-sm px-6 py-3 flex items-center gap-2">
                View Dashboard <ChevronRight className="w-4 h-4" />
              </Link>
              <Link to="/citizen/login" className="px-6 py-3 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                Create Account
              </Link>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  )
}
