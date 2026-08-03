import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ChatScreen from './screens/ChatScreen';
import DashboardScreen from './screens/DashboardScreen';
import AssistantScreen from './screens/AssistantScreen';
import ProfileScreen from './screens/ProfileScreen';
import FeedbackScreen from './screens/FeedbackScreen';
import SettingsScreen from './screens/SettingsScreen';
import EvolutionScreen from './screens/EvolutionScreen';
import SurgeryScreen from './screens/SurgeryScreen';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<ChatScreen />} />
        <Route path="dashboard" element={<DashboardScreen />} />
        <Route path="assistant" element={<AssistantScreen />} />
        <Route path="profile" element={<ProfileScreen />} />
        <Route path="feedback" element={<FeedbackScreen />} />
        <Route path="evolution" element={<EvolutionScreen />} />
        <Route path="surgery" element={<SurgeryScreen />} />
        <Route path="settings" element={<SettingsScreen />} />
      </Route>
    </Routes>
  );
}
