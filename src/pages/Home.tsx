// Home. The plan, today's batches and reports arrive in Phase 3.
import { Card } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function Home() {
  const { me } = useAuth()
  if (!me) return null
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-ae-blue">Hi {me.name.split(' ')[0]}</h2>
      <Card>
        <p className="text-stone-600">Plan and batches coming soon.</p>
      </Card>
    </div>
  )
}
