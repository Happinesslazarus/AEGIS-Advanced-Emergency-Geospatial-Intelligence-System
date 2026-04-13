import { Link } from 'react-router-dom'
import { Shield, Home, Search, ArrowLeft } from 'lucide-react'

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-950 via-gray-900 to-aegis-950 text-white relative overflow-hidden">
      {/* BG Effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-aegis-500/5 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-red-500/5 blur-[100px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.02)_1px,transparent_0)] bg-[length:40px_40px]" />
      </div>

      <div className="relative z-10 text-center px-6 max-w-md">
        <div className="mb-8">
          <Shield className="w-16 h-16 text-aegis-500/50 mx-auto mb-4" />
          <h1 className="text-8xl font-bold text-aegis-500/20">404</h1>
        </div>

        <h2 className="text-2xl font-bold mb-2">Area Not Found</h2>
        <p className="text-sm text-gray-400 mb-8">The page you're looking for doesn't exist or has been moved. Our sensors couldn't detect anything at this location.</p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/" className="btn-primary flex items-center justify-center gap-2">
            <Home className="w-4 h-4" /> Back to Home
          </Link>
          <Link to="/guest" className="px-4 py-2.5 rounded-xl border border-white/10 text-sm font-semibold hover:bg-white/5 transition-colors flex items-center justify-center gap-2">
            <Search className="w-4 h-4" /> View Dashboard
          </Link>
        </div>

        <Link to="/" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-400 mt-6 transition-colors">
          <ArrowLeft className="w-3 h-3" /> Return to safety
        </Link>
      </div>
    </div>
  )
}
