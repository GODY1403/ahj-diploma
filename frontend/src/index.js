import './style.css';
import Api from './js/Api';
import Organizer from './js/Organizer';

new Organizer(new Api(__API_URL__)).init();
