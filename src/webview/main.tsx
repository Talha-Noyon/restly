import './styles.css'
import {render} from 'preact'
import {RequestApp} from './RequestApp'
import {EnvironmentApp} from './EnvironmentApp'

const root = document.getElementById('root')!
render(document.body.dataset.view === 'environment' ? <EnvironmentApp /> : <RequestApp />, root)
