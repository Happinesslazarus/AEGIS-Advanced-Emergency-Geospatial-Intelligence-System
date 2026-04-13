import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Shield, Eye, EyeOff, Mail, Lock, ArrowRight, Terminal, Activity, BarChart3, Users } from 'lucide-react'

export default function AdminLogin() {
  const [showPw, setShowPw] = useState(false)

  return (
    <div className="min-h-screen flex relative overflow-hidden bg-gradient-to-br from-gray-950 via-gray-900 to-aegis-950">
      {/* Animated BG */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-96 h-96 rounded-full bg-aegis-600/10 blur-[120px] animate-float" />
        <div className="absolute bottom-1/3 right-1/3 w-80 h-80 rounded-full bg-indigo-500/10 blur-[100px] animate-float" style={{ animationDelay: '-4s' }} />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.03)_1px,transparent_0)] bg-[length:40px_40px]" />
      </div>

      {/* Left — Operator Info */}
      <div className="hidden lg:flex flex-col justify-center flex-1 p-12 relative z-10">
        <Link to="/" className="flex items-center gap-2 mb-12 text-white">
          <Shield className="w-8 h-8 text-aegis-400" />
          <span className="text-xl font-bold">AEGIS</span>
          <span className="text-xs font-bold bg-aegis-500/20 text-aegis-300 px-2 py-0.5 rounded-full">OPERATOR</span>
        </Link>
        <h1 className="text-4xl font-bold text-white mb-4">Command<br /><span className="gradient-text">Centre Access</span></h1>
        <p className="text-gray-400 max-w-sm mb-10">Authorised personnel only. Access the AEGIS operator dashboard to manage disaster response operations.</p>
        <div className="space-y-4">
          {[
            { icon: Terminal, title: 'Command Centre', desc: 'Real-time operational dashboard with AI insights' },
            { icon: Activity, title: 'Live Analytics', desc: 'Monitor reports, classify disasters with ML models' },
            { icon: BarChart3, title: 'Resource Management', desc: 'Deploy resources, manage shelters and responders' },
            { icon: Users, title: 'Citizen Oversight', desc: 'Monitor citizen reports, verify accounts, triage SOS signals' },
          ].map(f => (
            <div key={f.title} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
              <f.icon className="w-5 h-5 text-aegis-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-white">{f.title}</h3>
                <p className="text-xs text-gray-400">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right — Form */}
      <div className="w-full lg:w-[460px] flex items-center justify-center p-6 sm:p-10 relative z-10">
        <div className="w-full max-w-[380px] space-y-6">
          <div className="lg:hidden flex items-center gap-2 mb-4">
            <Shield className="w-6 h-6 text-aegis-400" />
            <span className="text-lg font-bold text-white">AEGIS</span>
            <span className="text-[10px] font-bold bg-aegis-500/20 text-aegis-300 px-2 py-0.5 rounded-full">OPERATOR</span>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white">Operator Sign In</h2>
            <p className="text-sm text-gray-400 mt-1">Enter your credentials to access the command centre</p>
          </div>

          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-xs text-amber-400 flex items-start gap-2">
              <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
              This portal is for authorised emergency response personnel only. Unauthorised access is prohibited.
            </p>
          </div>

          <form className="space-y-4" onSubmit={e => e.preventDefault()}>
            <div>
              <label className="block text-xs font-semibold text-gray-200 mb-1.5">Operator ID / Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input type="email" placeholder="operator@aegis.gov" className="input pl-10 w-full" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-200 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input type={showPw ? 'text' : 'password'} placeholder="••••••••" className="input pl-10 pr-10 w-full" />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Link to="/admin/dashboard">
              <button className="btn-primary w-full mt-2 flex items-center justify-center gap-2 group">
                Access Command Centre
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </Link>
          </form>

          <p className="text-center text-xs text-gray-500">
            Need access?{' '}
            <a href="#" className="text-aegis-400 hover:text-aegis-300 font-semibold transition-colors">Contact your administrator</a>
          </p>

          <Link to="/" className="flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-gray-400 transition-colors mt-2">
            ← Back to AEGIS Home
          </Link>
        </div>
      </div>
    </div>
  )
}
