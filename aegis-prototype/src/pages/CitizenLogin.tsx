import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Shield, Eye, EyeOff, Mail, Lock, User, ChevronRight, Fingerprint, ArrowRight } from 'lucide-react'

export default function CitizenLogin() {
  const [isRegister, setIsRegister] = useState(false)
  const [showPw, setShowPw] = useState(false)

  return (
    <div className="min-h-screen flex relative overflow-hidden bg-gradient-to-br from-gray-950 via-gray-900 to-aegis-950">
      {/* Animated BG */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-aegis-500/10 blur-[120px] animate-float" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-purple-500/10 blur-[100px] animate-float" style={{ animationDelay: '-3s' }} />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.03)_1px,transparent_0)] bg-[length:40px_40px]" />
      </div>

      {/* Left — Feature Highlights */}
      <div className="hidden lg:flex flex-col justify-center flex-1 p-12 relative z-10">
        <Link to="/" className="flex items-center gap-2 mb-12 text-white">
          <Shield className="w-8 h-8 text-aegis-400" />
          <span className="text-xl font-bold">AEGIS</span>
        </Link>
        <h1 className="text-4xl font-bold text-white mb-4">Your safety,<br /><span className="gradient-text">our priority.</span></h1>
        <p className="text-gray-400 max-w-sm mb-10">Join the AEGIS citizen network — report disasters, receive real-time alerts, and stay connected with your community.</p>
        <div className="space-y-4">
          {[
            { icon: '🗺️', title: 'Live Map & Alerts', desc: 'Real-time disaster tracking with AI-powered analysis' },
            { icon: '🆘', title: 'One-Tap SOS', desc: 'Instantly alert emergency responders with your location' },
            { icon: '🏠', title: 'Shelter Finder', desc: 'Find the nearest safe zone with live capacity data' },
            { icon: '👥', title: 'Community Network', desc: 'Connect with neighbours, share resources, stay safe' },
          ].map(f => (
            <div key={f.title} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
              <span className="text-xl mt-0.5">{f.icon}</span>
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
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white">{isRegister ? 'Create Account' : 'Welcome Back'}</h2>
            <p className="text-sm text-gray-400 mt-1">{isRegister ? 'Join the AEGIS citizen network' : 'Sign in to access your citizen portal'}</p>
          </div>

          <form className="space-y-4" onSubmit={e => e.preventDefault()}>
            {isRegister && (
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1.5">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input type="text" placeholder="Your full name" className="input pl-10 w-full" />
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-200 mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input type="email" placeholder="citizen@email.com" className="input pl-10 w-full" />
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

            {!isRegister && (
              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-1.5 text-gray-400 cursor-pointer">
                  <input type="checkbox" className="w-3.5 h-3.5 rounded border-gray-600 bg-transparent" />
                  Remember me
                </label>
                <a href="#" className="text-aegis-400 hover:text-aegis-300 font-semibold transition-colors">Forgot password?</a>
              </div>
            )}

            <Link to="/citizen/dashboard">
              <button className="btn-primary w-full mt-2 flex items-center justify-center gap-2 group">
                {isRegister ? 'Create Account' : 'Sign In'}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </Link>
          </form>

          <div className="relative flex items-center gap-4">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-gray-500">or continue with</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-gray-300 hover:bg-white/[0.08] transition-colors">
              <Fingerprint className="w-4 h-4" /> Biometric
            </button>
            <button className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-gray-300 hover:bg-white/[0.08] transition-colors">
              <Mail className="w-4 h-4" /> Google
            </button>
          </div>

          <p className="text-center text-xs text-gray-500">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button onClick={() => setIsRegister(!isRegister)} className="text-aegis-400 hover:text-aegis-300 font-semibold transition-colors">
              {isRegister ? 'Sign In' : 'Register'}
            </button>
          </p>

          <Link to="/guest" className="flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-gray-400 transition-colors mt-2 group">
            Continue as Guest <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </div>
    </div>
  )
}
