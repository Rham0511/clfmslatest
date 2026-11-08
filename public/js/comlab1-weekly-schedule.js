window.COMLAB1_WEEKLY_SCHEDULES = [
  {
    id: 'hardcoded-comlab1-monday-afternoon',
    dayOfWeek: 'Monday',
    startTime: '1:00 PM',
    endTime: '3:30 PM',
    subject: 'ITC 211 - Data Structures with Algorithm',
    instructor: 'MAM SHERYL LAINEZ',
    roomNote: 'ONSITE (MAM SHERYL LAINEZ) 2F1',
    scheduleColor: '#0e7490'
  },
  {
    id: 'hardcoded-comlab1-tuesday-morning',
    dayOfWeek: 'Tuesday',
    startTime: '7:30 AM',
    endTime: '10:30 AM',
    subject: 'ITC 112 - Computer Programming 1',
    instructor: 'MAM GLENDA BINAY',
    roomNote: 'ONSITE (MAM GLENDA BINAY) 1F2',
    scheduleColor: '#047857'
  },
  {
    id: 'hardcoded-comlab1-tuesday-afternoon',
    dayOfWeek: 'Tuesday',
    startTime: '1:00 PM',
    endTime: '3:30 PM',
    subject: 'ITC 112 - Computer Programming 1',
    instructor: 'MAM GLENDA BINAY',
    roomNote: 'ONSITE (MAM GLENDA BINAY) 1F1',
    scheduleColor: '#047857'
  },
  {
    id: 'hardcoded-comlab1-wednesday-morning',
    dayOfWeek: 'Wednesday',
    startTime: '7:30 AM',
    endTime: '10:00 AM',
    subject: 'ITC 311 - Web Systems and Technologies 2',
    instructor: 'SIR URIEL MELENDRES',
    roomNote: 'ONSITE (SIR URIEL MELENDRES) 3F3',
    scheduleColor: '#1d4ed8'
  },
  {
    id: 'hardcoded-comlab1-wednesday-afternoon',
    dayOfWeek: 'Wednesday',
    startTime: '1:00 PM',
    endTime: '3:30 PM',
    subject: 'ITC 112 - Computer Programming 1',
    instructor: 'MAM GLENDA BINAY',
    roomNote: 'ONSITE (MAM GLENDA BINAY) 1F3',
    scheduleColor: '#047857'
  },
  {
    id: 'hardcoded-comlab1-thursday-morning',
    dayOfWeek: 'Thursday',
    startTime: '7:30 AM',
    endTime: '10:00 AM',
    subject: 'ITE 212 - Object Oriented Programming',
    instructor: 'SIR PJ DE GUZMAN',
    roomNote: 'ONSITE (SIR PJ DE GUZMAN) 2F1',
    scheduleColor: '#7c3aed'
  },
  {
    id: 'hardcoded-comlab1-thursday-afternoon',
    dayOfWeek: 'Thursday',
    startTime: '1:00 PM',
    endTime: '3:30 PM',
    subject: 'ITC 311 - Web Systems and Technologies 2',
    instructor: 'SIR PJ DE GUZMAN',
    roomNote: 'ONSITE (SIR PJ DE GUZMAN) 3F1',
    scheduleColor: '#1d4ed8'
  },
  {
    id: 'hardcoded-comlab1-friday-morning',
    dayOfWeek: 'Friday',
    startTime: '7:30 AM',
    endTime: '10:00 AM',
    subject: 'ITE 211 - Human Computer Interaction 2',
    instructor: 'MAM GLENDA BINAY',
    roomNote: 'ONSITE (MAM GLENDA BINAY) 2F1',
    scheduleColor: '#be123c'
  },
  {
    id: 'hardcoded-comlab1-friday-afternoon',
    dayOfWeek: 'Friday',
    startTime: '1:00 PM',
    endTime: '3:30 PM',
    subject: 'ITC 212 - Information Management',
    instructor: 'SIR JEFFREY PENDIL',
    roomNote: 'ONSITE (SIR JEFFREY PENDIL) 2F1',
    scheduleColor: '#b45309'
  }
].map((schedule) => ({
  ...schedule,
  isHardcoded: true,
  laboratoryRoom: 'Laboratory 1 — Room 202'
}));
