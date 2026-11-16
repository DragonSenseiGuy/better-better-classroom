import { test, expect } from 'bun:test';
import {
	buildProfileArgs,
	buildStreamArgs,
	buildSubmissionsArgs,
	encodeCourseId,
	findHomeRedirect,
	mergeCookies,
	parseCourseListPayload,
	parseMembersPayload,
	parseProfilesPayload,
	parseStreamResponse,
	parseSubmissionsPayload
} from './classroom-web.ts';
import { parseCoursesHtml, describeHomeHtml } from './course-discovery.ts';
import type { Json } from './classroom/proto.ts';

test('merges rotated cookies and drops expired ones', () => {
	expect(
		mergeCookies('SID=a; SIDCC=old; HSID=h', [
			'SIDCC=new; Path=/; Secure',
			'HSID=; Max-Age=0',
			'NEW=x; Domain=.google.com'
		])
	).toBe('SID=a; SIDCC=new; NEW=x');
});

test('course members come from the keyed record', () => {
	expect(
		parseMembersPayload([
			'hrq.crs',
			null,
			[[['805'], null, 1789380345319, { '8': [['s1'], ['s2']], '22': [['t1']], '53': true }]]
		])
	).toEqual({ students: ['s1', 's2'], teachers: ['t1'] });
	expect(parseMembersPayload(['hrq.crs', null, []])).toEqual({ students: [], teachers: [] });
});

test('profile args and parsing', () => {
	expect(buildProfileArgs(['1', '2'])).toBe(
		'[[null,null,1,0],[1,1,null,1,null,1,null,null,1,1,1,1,null,null,1],[[null,[[null,[1]],[null,[2]]]]]]'
	);
	expect(
		parseProfilesPayload([
			'hrq.usr',
			[],
			[
				[['491'], 'Dana Grey', 'dg@example.com', null, '//lh3.googleusercontent.com/a/x=mo'],
				[['492'], '', null, null, null]
			]
		])
	).toEqual([
		{
			id: '491',
			name: 'Dana Grey',
			email: 'dg@example.com',
			photoUrl: 'https://lh3.googleusercontent.com/a/x=mo'
		},
		{ id: '492', name: undefined, email: undefined, photoUrl: undefined }
	]);
});

const item = (id: string, courseId: string, text: string, html?: string) => [
	3,
	null,
	[
		[
			[id, [courseId]],
			1789395973678,
			null,
			[
				[
					null,
					'ABF6',
					null,
					null,
					null,
					null,
					['edu.rt', text, null, null, html ? [null, html] : null]
				]
			]
		]
	]
];

const assignment = (
	id: string,
	courseId: string,
	text: string,
	html: string,
	extra: { schedule?: unknown[]; folder?: unknown[]; topicId?: string } = {}
) => {
	const postItem: unknown[] = [
		[id, [courseId]],
		1784283111869,
		null,
		null,
		['638776461164'],
		'Title',
		null,
		null,
		2,
		html ? [[null, null, null, null, null, null, ['edu.rt', text, null, null, [null, html]]]] : null
	];
	if (extra.topicId) postItem[14] = [[extra.topicId, [courseId]]];
	return [2, [postItem, extra.schedule ?? null, extra.folder ?? null]];
};

// Materials arrive as wrapper-7 posts: titled PostItem five slots deep, no
// schedule or folder nodes, and usually no rich-text body.
const material = (id: string, courseId: string, topicId?: string) => {
	const postItem: unknown[] = [
		[id, [courseId]],
		1789395973678,
		null,
		null,
		['638776461164'],
		'Material title',
		null,
		null,
		2
	];
	if (topicId) postItem[14] = [[topicId, [courseId]]];
	return [7, null, null, null, null, [postItem]];
};

const envelope = (payload: unknown) => {
	const inner = JSON.stringify(payload);
	const line = JSON.stringify([
		['wrb.fr', 'pONvgf', inner, null, null, null, 'generic'],
		['di', 57]
	]);
	return `)]}'\n\n${line.length}\n${line}\n25\n[["e",4,null,null,160]]\n`;
};

test('encodes course ids the way Classroom URLs do', () => {
	expect(encodeCourseId('869476118207')).toBe('ODY5NDc2MTE4MjA3');
});

test('builds first and continuation page args', () => {
	expect(buildStreamArgs('123', 10)).toStartWith('[[10,null,1,0],');
	expect(buildStreamArgs('123', 10)).toEndWith(',[[[2,3],[[123]],null,[2]]]]');
	expect(buildStreamArgs('123', 10, 'tok=')).toStartWith('[[10,"tok=",1,0],');
});

test('parses items, html and pagination', () => {
	const text = envelope([
		'hrsi.qr',
		[true, ['EhIS']],
		[
			item('1', '9', 'Plain', '<div>Plain</div>'),
			item('2', '9', 'No html'),
			assignment('3', '9', 'Work', '<div><b>Work</b></div>')
		]
	]);
	expect(parseStreamResponse(text)).toEqual({
		hasMore: true,
		token: 'EhIS',
		items: [
			{
				id: '1',
				courseId: '9',
				text: 'Plain',
				html: '<div>Plain</div>',
				creatorId: undefined,
				kind: 'announcement',
				createdAt: 1789395973678
			},
			{
				id: '2',
				courseId: '9',
				text: 'No html',
				html: undefined,
				creatorId: undefined,
				kind: 'announcement',
				createdAt: 1789395973678
			},
			{
				id: '3',
				courseId: '9',
				text: 'Work',
				html: '<div><b>Work</b></div>',
				creatorId: '638776461164',
				kind: 'courseWork',
				title: 'Title',
				createdAt: 1784283111869
			}
		]
	});
});

test('empty stream', () => {
	expect(parseStreamResponse(envelope(['hrsi.qr', [false]]))).toEqual({
		hasMore: false,
		token: undefined,
		items: []
	});
});

test('materials are wrapper-7 posts with titles and no body', () => {
	expect(
		parseStreamResponse(envelope(['hrsi.qr', [false], [material('7', '9', 'topic1')]])).items
	).toEqual([
		{
			id: '7',
			courseId: '9',
			text: '',
			html: undefined,
			creatorId: '638776461164',
			kind: 'material',
			title: 'Material title',
			createdAt: 1789395973678,
			topicId: 'topic1'
		}
	]);
});

test('coursework without a rich-text body is kept with empty text', () => {
	expect(
		parseStreamResponse(envelope(['hrsi.qr', [false], [assignment('4', '9', '', '')]])).items
	).toEqual([
		{
			id: '4',
			courseId: '9',
			text: '',
			html: undefined,
			creatorId: '638776461164',
			kind: 'courseWork',
			title: 'Title',
			createdAt: 1784283111869
		}
	]);
});

test('coursework schedule, folder and topic come from the entry body', () => {
	const due = 1794585540000;
	const assigned = 1784283111869;
	expect(
		parseStreamResponse(
			envelope([
				'hrsi.qr',
				[false],
				[
					assignment('5', '9', 'Work', '<div>Work</div>', {
						schedule: [due, assigned, false, 5],
						folder: ['opaque', null, 'https://drive.google.com/drive/folders/abc'],
						topicId: 'topic2'
					})
				]
			])
		).items
	).toEqual([
		{
			id: '5',
			courseId: '9',
			text: 'Work',
			html: '<div>Work</div>',
			creatorId: '638776461164',
			kind: 'courseWork',
			title: 'Title',
			createdAt: assigned,
			dueAt: due,
			maxPoints: 5,
			topicId: 'topic2',
			driveFolderUrl: 'https://drive.google.com/drive/folders/abc'
		}
	]);
});

test('contentless entries without title or body are skipped', () => {
	expect(
		parseStreamResponse(
			envelope(['hrsi.qr', [false], [[7, null, null, null, null, [[['8', ['9']]]]]]])
		).items
	).toEqual([]);
});

test('rpc error surfaces', () => {
	const line = JSON.stringify([
		['wrb.fr', 'pONvgf', null, null, null, [3, 'PERMISSION_DENIED'], 'generic']
	]);
	expect(() => parseStreamResponse(`)]}'\n\n1\n${line}\n`)).toThrow(/PERMISSION_DENIED/);
});

const b64 = (id: string) => Buffer.from(id).toString('base64');

test('finds courses from card links', () => {
	const html = `
		<a href="/c/${b64('123456789012')}">Biology 101</a>
		<a href="/c/${b64('987654321098')}">Algebra II</a>
		<a href="/settings">Settings</a>`;
	expect(parseCoursesHtml(html)).toEqual([
		{ id: '123456789012', name: 'Biology 101' },
		{ id: '987654321098', name: 'Algebra II' }
	]);
});

test('falls back to id/name pairs and skips noise', () => {
	const html = `["123456789012","Chemistry",["dg@example.com"],["home"]]`;
	expect(parseCoursesHtml(html)).toEqual([{ id: '123456789012', name: 'Chemistry' }]);
});

test('unions card links and embedded pairs', () => {
	const html = `<a href="/c/${b64('111111111111')}">From Link</a>["222222222222","From Pair"]`;
	expect(parseCoursesHtml(html)).toEqual([
		{ id: '111111111111', name: 'From Link' },
		{ id: '222222222222', name: 'From Pair' }
	]);
});

test('empty page finds nothing', () => {
	expect(parseCoursesHtml('<html><body>signed out</body></html>')).toEqual([]);
});

test('decodes entities and numeric refs in course names', () => {
	const html = `<a href="/c/${b64('123456789012')}">Biology &amp; Chemistry &#39;25</a>`;
	expect(parseCoursesHtml(html)).toEqual([{ id: '123456789012', name: "Biology & Chemistry '25" }]);
});

test('finds course names wrapped in nested card markup', () => {
	const html = `<a href="/c/${b64('123456789012')}"><span><div>Biology 101</div></span></a>`;
	expect(parseCoursesHtml(html)).toEqual([{ id: '123456789012', name: 'Biology 101' }]);
});

test('skips card links whose inner text is polluted with extra content', () => {
	const longInner = `Course Name ${'filler '.repeat(40)}`;
	const html =
		`<a href="/c/${b64('123456789012')}"><span>${longInner}</span></a>` +
		`["123456789012","Biology 101"]`;
	expect(parseCoursesHtml(html)).toEqual([{ id: '123456789012', name: 'Biology 101' }]);
});

test('array in the title slot is not mistaken for a title', () => {
	const text = envelope([
		'hrsi.qr',
		[false],
		[
			[
				3,
				null,
				[
					[
						['9', ['42']],
						1789395973678,
						null,
						null,
						null,
						[['nested', 'array']],
						['edu.rt', 'Hello', null, null, [null, '<div>Hello</div>']]
					]
				]
			]
		]
	]);
	expect(parseStreamResponse(text).items).toEqual([
		{
			id: '9',
			courseId: '42',
			text: 'Hello',
			html: '<div>Hello</div>',
			creatorId: undefined,
			kind: 'announcement',
			title: undefined,
			createdAt: 1789395973678
		}
	]);
});

test('finds client-side hops out of the home shell page', () => {
	expect(findHomeRedirect('<html><body>courses here</body></html>')).toBeNull();
	expect(findHomeRedirect('<meta http-equiv="refresh" content="0;url=/u/0/h/st">')).toBe(
		'/u/0/h/st'
	);
	expect(findHomeRedirect('<script>location.replace("/u/0/h/st")</script>')).toBe('/u/0/h/st');
	expect(findHomeRedirect('<script>window.location="/u/2/h/st?hl=en"</script>')).toBe(
		'/u/2/h/st?hl=en'
	);
	expect(
		findHomeRedirect('<script>AF_initDataCallback("redirectUrl":"\\/u\\/0\\/h\\/st")</script>')
	).toBe('/u/0/h/st');
});

test('ignores off-origin and off-classroom redirect targets', () => {
	expect(
		findHomeRedirect('<script>location.replace("https://accounts.google.com/x")</script>')
	).toBeNull();
	expect(
		findHomeRedirect('<script>location.replace("https://evil.com/u/0/h")</script>')
	).toBeNull();
	expect(findHomeRedirect('<script>location.replace("/u/0/r/xyz")</script>')).toBeNull();
});

test('accepts spaced id/name pairs', () => {
	const html =
		`<a href="/c/${b64('123456789012')}">Physics</a>` +
		`["888888888888" , "Spaced Out"]` +
		`[ "777777777777" , "Extra Spaces" ]`;
	expect(
		parseCoursesHtml(html)
			.map((c) => c.name)
			.sort()
	).toEqual(['Extra Spaces', 'Physics', 'Spaced Out']);
});

test('describeHomeHtml counts signals without leaking page content', () => {
	const b64 = Buffer.from('123456789012').toString('base64');
	const html = `<a href="/c/${b64}">Bio</a>["123456789012","Bio"]AF_initDataCallbackAF_initDataCallback`;
	const diag = describeHomeHtml(html);
	expect(diag.bytes).toBe(html.length);
	expect(diag.courseLinks).toBe(1);
	expect(diag.idPairs).toBe(1);
	expect(diag.initData).toBe(2);
	expect(JSON.stringify(diag)).not.toContain('Bio');
	expect(describeHomeHtml('<html>shell</html>')).toEqual({
		bytes: 18,
		courseLinks: 0,
		idPairs: 0,
		initData: 0
	});
});

const courseRec = (values: Record<number, Json>): Json => {
	const r: Json[] = new Array(24).fill(null);
	for (const [i, v] of Object.entries(values)) r[Number(i)] = v;
	return r;
};

test('parses the course list payload with sections, rooms and states', () => {
	const payload = [
		'hrq.crs',
		[false],
		[
			courseRec({
				0: ['876371853259'],
				1: 1787942363020,
				2: 1789559573290,
				5: 'Geometry Honors',
				6: [['33448387591']],
				8: 'Bromberg',
				11: 'We meet Fridays',
				14: '156W',
				20: 1,
				23: 'https://calendar.google.com/render?cid=c_abc123@group.calendar.google.com&authuser=0'
			}),
			courseRec({ 0: ['774782350284'], 5: 'Old Science', 20: 2 })
		]
	];
	expect(parseCourseListPayload(payload)).toEqual([
		{
			id: '876371853259',
			name: 'Geometry Honors',
			section: 'Bromberg',
			descriptionHeading: 'We meet Fridays',
			room: '156W',
			ownerId: '33448387591',
			calendarId: 'c_abc123@group.calendar.google.com',
			creationTime: new Date(1787942363020).toISOString(),
			updateTime: new Date(1789559573290).toISOString(),
			courseState: 'ACTIVE'
		},
		{
			id: '774782350284',
			name: 'Old Science',
			section: undefined,
			descriptionHeading: undefined,
			room: undefined,
			ownerId: undefined,
			calendarId: undefined,
			creationTime: undefined,
			updateTime: undefined,
			courseState: 'ARCHIVED'
		}
	]);
});

test('skips malformed and duplicate list records', () => {
	expect(
		parseCourseListPayload([
			'hrq.crs',
			[false],
			[
				courseRec({ 0: ['876371853259'], 5: 'Kept' }),
				courseRec({ 0: ['876371853259'], 5: 'Duplicate' }),
				courseRec({ 0: ['not-an-id'], 5: 'Bad id' }),
				courseRec({ 0: ['876371853260'], 5: '' }),
				'garbage',
				null
			]
		]).map((c) => c.name)
	).toEqual(['Kept']);
	expect(parseCourseListPayload(['hrq.crs', null, []])).toEqual([]);
	expect(parseCourseListPayload({})).toEqual([]);
});

// ---- submission reads (Zj93ge, student-keyed batched query) -----------------
//
// Shapes captured 2026-11-16 from the /u/N/a/{not-turned-in,missing,
// turned-in}/all pages; ids redacted to same-length placeholders. Field
// indexes documented at the parser.

test('builds the student-keyed batched query the to-do pages send', () => {
	expect(
		buildSubmissionsArgs([
			{ studentId: '785201550080', workId: '899335145432', courseId: '876371853259' },
			{ studentId: '785201550080', workId: '891021569117', courseId: '875952371903' }
		])
	).toBe(
		'[[null,null,1,0],' +
			'[null,1,null,null,1,null,1,1,1,null,null,null,1,null,[1],null,null,null,1,1,1,' +
			'null,null,null,[[1,1]],[[1,1]],[1,[[1,1,[],[null,1,1]],1,1,1]],null,null,null,null,1],' +
			'[null,null,[[785201550080,[899335145432,[876371853259]]],' +
			'[785201550080,[891021569117,[875952371903]]]]],1]'
	);
});

// The trailing 1 is an args-level field, not part of the key wrapper; a copy
// inside the key wrapper is what made the first replay of this RPC reject.
test('keeps the trailing flag outside the key wrapper', () => {
	const args = JSON.parse(buildSubmissionsArgs([{ studentId: '1', workId: '2', courseId: '3' }]));
	expect(args.length).toBe(4);
	expect(args[2].length).toBe(3);
	expect(args[3]).toBe(1);
});

test('parses submission records with states, grades and the late substate', () => {
	const rec = (over: Record<number, Json>) => {
		const r: Json[] = new Array(33).fill(null);
		r[0] = ['785201550080', ['899335145432', ['876371853259']]];
		r[2] = 1794586353333;
		r[7] = ['785201550080'];
		return Object.assign(r, over);
	};
	expect(
		parseSubmissionsPayload([
			'hrq.sub',
			[false],
			[
				// assigned
				rec({ 5: 4, 13: 0, 20: 1, 32: 1 }),
				// turned in on time
				rec({ 5: 2, 13: 0, 20: 3, 21: 1794338431882, 32: 1 }),
				// turned in late
				rec({ 5: 2, 13: 0, 20: 4, 21: 1793370827098, 32: 1 }),
				// returned with a grade, on time
				rec({ 5: 3, 13: 0, 20: 8, 21: 1793899844377, 8: 39.5, 32: 4 }),
				// returned late
				rec({ 5: 3, 13: 1, 20: 10, 21: 1793650180158, 8: 14.5, 32: 1 }),
				// returned without a student turn-in (substate 5)
				rec({ 5: 3, 13: 0, 20: 5, 8: 2, 32: 3 }),
				// reclaimed (state seen on live captures)
				rec({ 5: 5, 13: 0, 20: 1, 32: 1 }),
				// unknown state is skipped, not guessed
				rec({ 5: 9, 20: 1 })
			]
		])
	).toEqual([
		{
			studentId: '785201550080',
			workId: '899335145432',
			courseId: '876371853259',
			state: 'CREATED',
			late: false,
			assignedGrade: undefined,
			turnInAt: undefined,
			updatedAt: 1794586353333
		},
		{
			studentId: '785201550080',
			workId: '899335145432',
			courseId: '876371853259',
			state: 'TURNED_IN',
			late: false,
			assignedGrade: undefined,
			turnInAt: 1794338431882,
			updatedAt: 1794586353333
		},
		{
			studentId: '785201550080',
			workId: '899335145432',
			courseId: '876371853259',
			state: 'TURNED_IN',
			late: true,
			assignedGrade: undefined,
			turnInAt: 1793370827098,
			updatedAt: 1794586353333
		},
		{
			studentId: '785201550080',
			workId: '899335145432',
			courseId: '876371853259',
			state: 'RETURNED',
			late: false,
			assignedGrade: 39.5,
			turnInAt: 1793899844377,
			updatedAt: 1794586353333
		},
		{
			studentId: '785201550080',
			workId: '899335145432',
			courseId: '876371853259',
			state: 'RETURNED',
			late: true,
			assignedGrade: 14.5,
			turnInAt: 1793650180158,
			updatedAt: 1794586353333
		},
		{
			studentId: '785201550080',
			workId: '899335145432',
			courseId: '876371853259',
			state: 'RETURNED',
			late: false,
			assignedGrade: 2,
			turnInAt: undefined,
			updatedAt: 1794586353333
		},
		{
			studentId: '785201550080',
			workId: '899335145432',
			courseId: '876371853259',
			state: 'RECLAIMED_BY_STUDENT',
			late: false,
			assignedGrade: undefined,
			turnInAt: undefined,
			updatedAt: 1794586353333
		}
	]);
	expect(parseSubmissionsPayload(['hrq.sub', [false], []])).toEqual([]);
	expect(parseSubmissionsPayload(['hrq.sub', [false], ['garbage', null]])).toEqual([]);
	expect(parseSubmissionsPayload({})).toEqual([]);
});
