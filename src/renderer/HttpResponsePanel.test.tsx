// @vitest-environment jsdom
import { fireEvent,render,screen } from '@testing-library/react'
import { expect,it } from 'vitest'
import HttpResponsePanel from './HttpResponsePanel'
it('shows 4xx as a response and safely formats JSON',()=>{render(<HttpResponsePanel error="" response={{status:400,statusText:'Bad Request',durationMs:10,sizeBytes:7,kind:'json',headers:{'content-type':'application/json'},text:'{"x":1}'}}/>);expect(screen.getByText(/400 Bad Request/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Pretty'}));expect(screen.getByText(/"x": 1/)).toBeInTheDocument()})
