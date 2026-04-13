import { Link } from 'react-router-dom'
import { Shield, Lock, Wifi } from 'lucide-react'

export default function Footer() {
  return (
    <footer className="border-t border-gray-200/60 dark:border-white/5 bg-gray-50/50 dark:bg-white/[0.01]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <span className="font-black text-sm text-aegis-600 dark:text-aegis-400">AEGIS</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
              Advanced Emergency Geospatial Intelligence System — AI-powered disaster response for the UK.
            </p>
            <p className="text-[10px] text-gray-400">BSc Honours — Robert Gordon University</p>
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-900 dark:text-white tracking-wider uppercase mb-3">Platform</h4>
            <div className="space-y-2">
              <Link to="/citizen" className="block text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400">Citizen Portal</Link>
              <Link to="/admin" className="block text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400">Operator Console</Link>
              <Link to="/guest" className="block text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400">Public Dashboard</Link>
            </div>
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-900 dark:text-white tracking-wider uppercase mb-3">Resources</h4>
            <div className="space-y-2">
              <Link to="/about" className="block text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400">About AEGIS</Link>
              <a href="#features" className="block text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400">Features</a>
              <a href="#how-it-works" className="block text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400">How It Works</a>
            </div>
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-900 dark:text-white tracking-wider uppercase mb-3">Legal</h4>
            <div className="space-y-2">
              <Link to="/privacy" className="block text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400">Privacy Policy</Link>
              <Link to="/terms" className="block text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400">Terms of Service</Link>
              <Link to="/accessibility" className="block text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400">Accessibility</Link>
              <Link to="/creator" className="block text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400">Creator</Link>
            </div>
          </div>
        </div>
        <div className="pt-6 border-t border-gray-200/60 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[10px] text-gray-400">© 2026 AEGIS — Happiness Ada Lazarus · Robert Gordon University</p>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400"><Lock className="w-3 h-3" /> End-to-End Encrypted</span>
            <span className="text-gray-300 dark:text-gray-700">·</span>
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400"><Wifi className="w-3 h-3" /> 99.9% Uptime</span>
            <span className="text-gray-300 dark:text-gray-700">·</span>
            <span className="text-[10px] text-gray-400">GDPR Compliant</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
