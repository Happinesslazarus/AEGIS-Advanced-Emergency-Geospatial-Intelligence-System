import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Shield } from 'lucide-react'

// The full citizen experience is in CitizenPortal.
// CitizenDashboard simply renders the portal (acts as the authenticated entry point).
export default function CitizenDashboard() {
  return <Navigate to="/citizen" replace />
}
