// @vitest-environment jsdom
import { fireEvent,render,screen } from '@testing-library/react'
import { expect,it,vi } from 'vitest'
import HttpRequestEditor from './HttpRequestEditor'
const draft:any={savedRequestId:'r',workspaceId:'w',name:'R',method:'POST',url:'http://localhost',params:[],headers:[],auth:{type:'none'},body:{type:'none'},settings:{timeoutMs:30000}}
it('switches auth and body editors and emits typed changes',()=>{const change=vi.fn();const {rerender}=render(<HttpRequestEditor draft={draft} onChange={change}/>);fireEvent.click(screen.getByRole('button',{name:'Auth'}));fireEvent.change(screen.getByLabelText('Auth type'),{target:{value:'bearer'}});expect(change).toHaveBeenLastCalledWith(expect.objectContaining({auth:{type:'bearer',token:''}}));rerender(<HttpRequestEditor draft={{...draft,body:{type:'json',content:'{}'}}} onChange={change}/>);fireEvent.click(screen.getByRole('button',{name:'Body'}));expect(screen.getByLabelText('Body content')).toHaveValue('{}')})
