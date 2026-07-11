// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import EnvironmentPanel from './EnvironmentPanel'

it('masks secret variables by default', () => {
  render(<EnvironmentPanel workspaceId="w" onClose={() => undefined} initialVariables={[{id:'v',environment_id:'e',key:'TOKEN',value:'fixture-secret-value',is_secret:1,description:''}]} />)
  expect(screen.queryByDisplayValue('fixture-secret-value')).not.toBeInTheDocument()
  expect(screen.getByDisplayValue('••••••••')).toBeInTheDocument()
})
