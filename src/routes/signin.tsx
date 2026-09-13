import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { authClient } from '#/lib/auth-client'
import { hasGoogleAuth } from '#/lib/auth'
import { useUserId } from '#/lib/user'

const getAuthProviders = createServerFn({ method: 'GET' }).handler(() => ({
  google: hasGoogleAuth,
}))

export const Route = createFileRoute('/signin')({
  component: SignIn,
  loader: () => getAuthProviders(),
})

const schema = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
  name: z.string(),
})

function SignIn() {
  const { google } = Route.useLoaderData()
  const router = useRouter()
  const { userId } = useUserId()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { email: '', password: '', name: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setError(null)
      const result =
        mode === 'signin'
          ? await authClient.signIn.email({
              email: value.email,
              password: value.password,
            })
          : await authClient.signUp.email({
              email: value.email,
              password: value.password,
              name: value.name || value.email.split('@')[0],
            })

      if (result.error) {
        setError(result.error.message ?? 'Something went wrong')
        return
      }
      await router.navigate({ to: '/' })
    },
  })

  if (userId) {
    return (
      <main className="mx-auto flex min-h-[calc(100vh-13rem)] w-full max-w-6xl items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">
          You’re signed in.{' '}
          <Link to="/" className="font-semibold text-primary underline-offset-4 hover:underline">
            Go to your board
          </Link>
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">
            {mode === 'signin' ? 'Sign in' : 'Create an account'}
          </CardTitle>
          <CardDescription>Budget Board keeps a separate board for every account.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {google ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() =>
                  void authClient.signIn.social({
                    provider: 'google',
                    callbackURL: '/',
                  })
                }
              >
                Continue with Google
              </Button>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Separator className="flex-1" />
                or
                <Separator className="flex-1" />
              </div>
            </>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void form.handleSubmit()
            }}
            className="flex flex-col gap-3"
          >
            {mode === 'signup' ? (
              <form.Field name="name">
                {(field) => (
                  <Input
                    placeholder="Name"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </form.Field>
            ) : null}

            <form.Field name="email">
              {(field) => (
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="Email"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            </form.Field>

            <form.Field name="password">
              {(field) => (
                <Input
                  type="password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  placeholder="Password"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            </form.Field>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting} className="w-full">
                  {isSubmitting ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
                </Button>
              )}
            </form.Subscribe>
          </form>

          <Button
            type="button"
            variant="link"
            className="w-full"
            onClick={() => {
              setError(null)
              setMode(mode === 'signin' ? 'signup' : 'signin')
            }}
          >
            {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
