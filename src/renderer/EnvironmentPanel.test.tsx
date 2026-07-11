// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import EnvironmentPanel from './EnvironmentPanel'

it('masks secret variables by default', () => {
  render(<EnvironmentPanel workspaceId="w" onClose={() => undefined} initialVariables={[{id:'v',environment_id:'e',key:'TOKEN',value:'fixture-secret-value',is_secret:1,description:''}]} />)
  expect(screen.queryByDisplayValue('fixture-secret-value')).not.toBeInTheDocument()
  expect(screen.getByDisplayValue('••••••••')).toBeInTheDocument()
})

it('restores selection, renames the environment, and edits a variable', async () => {
  const rename=vi.fn().mockResolvedValue({ok:true,data:{id:'e',name:'Test'}})
  const update=vi.fn().mockResolvedValue({ok:true,data:{id:'v'}})
  window.requestStudio={environments:{list:vi.fn().mockResolvedValue({ok:true,data:[{id:'e',name:'Local'}]}),getSelected:vi.fn().mockResolvedValue({ok:true,data:'e'}),select:vi.fn().mockResolvedValue({ok:true,data:'e'}),rename,create:vi.fn(),delete:vi.fn()},variables:{list:vi.fn().mockResolvedValue({ok:true,data:[{id:'v',environment_id:'e',key:'TOKEN',value:'old',is_secret:0,description:''}]}),update,create:vi.fn(),delete:vi.fn()}}
  render(<EnvironmentPanel workspaceId="w" onClose={()=>undefined}/>)
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Current environment'})).toHaveValue('e'))
  fireEvent.click(screen.getByRole('button',{name:'Rename'}));fireEvent.change(screen.getByLabelText('Environment name'),{target:{value:'  Test  '}});fireEvent.click(screen.getByRole('button',{name:'Save'}))
  await waitFor(()=>expect(rename).toHaveBeenCalledWith({id:'e',workspaceId:'w',name:'Test'}))
  fireEvent.click(screen.getByRole('button',{name:'Edit'}));fireEvent.change(screen.getByLabelText('Variable key'),{target:{value:' API_TOKEN '}});fireEvent.change(screen.getByLabelText('Variable value'),{target:{value:'new'}});fireEvent.click(screen.getByLabelText('Secret variable'));fireEvent.click(screen.getByRole('button',{name:'Save variable'}))
  await waitFor(()=>expect(update).toHaveBeenCalledWith({id:'v',environmentId:'e',key:'API_TOKEN',value:'new',isSecret:true,description:''}))
})
