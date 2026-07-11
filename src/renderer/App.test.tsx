// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from './App'

it('renders the fixed three-pane milestone shell', () => {
  render(<App />)
  expect(screen.getByRole('navigation', { name: 'Request explorer' })).toBeInTheDocument()
  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('complementary', { name: 'Response' })).toHaveTextContent('Send a request to see the response here.')
  expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
})
